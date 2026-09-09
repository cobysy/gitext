/**
 * The left panel's readers against real git.
 *
 * One repository is built up with everything the panel lists: a remote with a
 * tracking branch that is both ahead and behind, an annotated and a lightweight tag,
 * two stashes, a linked worktree and a submodule, and each reader is asserted against
 * it. The formats these parse are the ones most likely to shift under a git upgrade,
 * so pinning them against the real binary is worth more than another unit test.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listMergedRefs, listRefs } from '@main/git/refs.js';
import { getRemoteNames, listRemotes } from '@main/git/remote.js';
import { runGit } from '@main/git/runner.js';
import { listStashes } from '@main/git/stash.js';
import { listSubmodules, submoduleStatus } from '@main/git/submodule.js';
import { listWorktrees } from '@main/git/worktree.js';

let root = '';
let repo = '';
let origin = '';
let worktree = '';

const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

async function commit(cwd: string, message: string): Promise<void>
{
  await runGit(cwd, [...IDENTITY, 'commit', '--allow-empty', '-m', message]);
}

beforeAll(async () =>
{
  // git canonicalizes paths; on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-objects-')));
  repo = join(root, 'repo');
  origin = join(root, 'origin.git');
  worktree = join(root, 'wt');
  await mkdir(repo);

  await runGit(root, ['init', '--bare', '-b', 'main', origin]);
  await runGit(repo, ['init', '-b', 'main']);
  await commit(repo, 'first');

  await runGit(repo, ['remote', 'add', 'origin', origin]);
  await runGit(repo, ['remote', 'add', 'upstream', 'https://example.com/upstream.git']);
  await runGit(repo, ['push', '-u', 'origin', 'main']);
  // Set after pushing: git would otherwise push to this unreachable URL.
  await runGit(repo, ['config', 'remote.origin.pushurl', 'https://example.com/push.git']);

  // Diverge: one commit on the remote's copy of main, two on ours. Ahead 2, behind 1.
  const mirror = join(root, 'mirror');
  await runGit(root, ['clone', origin, mirror]);
  await commit(mirror, 'remote side');
  await runGit(mirror, ['push', 'origin', 'main']);
  await commit(repo, 'local one');
  await commit(repo, 'local two');
  await runGit(repo, ['fetch', 'origin']);

  await runGit(repo, ['branch', 'feature/x']);
  await runGit(repo, ['branch', 'feature/nested/deep']);
  await runGit(repo, ['tag', 'v0-light']);
  await runGit(repo, [...IDENTITY, 'tag', '-a', 'v1', '-m', 'annotated']);

  await writeFile(join(repo, 'a.txt'), 'one\n');
  await runGit(repo, ['add', 'a.txt']);
  await runGit(repo, [...IDENTITY, 'stash', 'push', '-m', 'first stash']);
  await writeFile(join(repo, 'b.txt'), 'two\n');
  await runGit(repo, ['add', 'b.txt']);
  await runGit(repo, [...IDENTITY, 'stash', 'push']);

  await runGit(repo, ['worktree', 'add', worktree, 'feature/x']);

  const sub = join(root, 'sub');
  await mkdir(sub);
  await runGit(sub, ['init', '-b', 'main']);
  await commit(sub, 'sub first');
  // git refuses the file:// protocol for submodules by default since 2.38.
  await runGit(repo, [
    ...IDENTITY,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    sub,
    'deps/lib'
  ]);
  await commit(repo, 'add submodule');
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('listRefs', () =>
{
  it('reports the checked-out branch with its upstream and divergence', async () =>
  {
    const main = (await listRefs(repo)).find((r) => r.fullName === 'refs/heads/main');
    expect(main).toMatchObject({
      name: 'main',
      kind: 'branch',
      isCurrent: true,
      upstream: 'origin/main',
      // Three commits made here since the push, one made on the remote's copy.
      ahead: 3,
      behind: 1,
      upstreamGone: false,
      remote: null,
      isAnnotated: false
    });
    expect(main?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(main?.date).toBeGreaterThan(0);
  });

  it('lists branches with slashes in their names without splitting them', async () =>
  {
    const names = (await listRefs(repo))
      .filter((r) => r.kind === 'branch')
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(['feature/nested/deep', 'feature/x', 'main']);
  });

  it('marks only the checked-out branch current', async () =>
  {
    const current = (await listRefs(repo)).filter((r) => r.isCurrent);
    expect(current.map((r) => r.name)).toEqual(['main']);
  });

  it('attributes remote branches to their remote and drops the remote HEAD', async () =>
  {
    const remotes = (await listRefs(repo)).filter((r) => r.kind === 'remote');
    expect(remotes.map((r) => [r.name, r.remote])).toEqual([['origin/main', 'origin']]);
  });

  it('peels an annotated tag to a commit and leaves a lightweight one alone', async () =>
  {
    const refs = await listRefs(repo);
    const annotated = refs.find((r) => r.name === 'v1');
    const light = refs.find((r) => r.name === 'v0-light');
    const head = await runGit(repo, ['rev-parse', 'HEAD~1']);

    expect(annotated).toMatchObject({ kind: 'tag', isAnnotated: true, sha: head.trim() });
    expect(light).toMatchObject({ kind: 'tag', isAnnotated: false, sha: head.trim() });
    // A peeled tag must still carry the commit's date, not an empty one.
    expect(annotated?.date).toBeGreaterThan(0);
  });

  it('reports a branch whose upstream has been deleted as gone', async () =>
  {
    await runGit(repo, ['branch', 'orphaned']);
    await runGit(repo, ['config', 'branch.orphaned.remote', 'origin']);
    await runGit(repo, ['config', 'branch.orphaned.merge', 'refs/heads/never-pushed']);

    const orphaned = (await listRefs(repo)).find((r) => r.name === 'orphaned');
    expect(orphaned).toMatchObject({ upstream: 'origin/never-pushed', upstreamGone: true });

    await runGit(repo, ['branch', '-D', 'orphaned']);
  });
});

describe('listMergedRefs', () =>
{
  it('reports the refs contained in a commit, and not the ones ahead of it', async () =>
  {
    // `feature/x` was branched from main and never moved, so main contains it; the
    // commits made on main since are not on `feature/x`.
    const merged = await listMergedRefs(repo, 'HEAD');
    expect(merged).toContain('refs/heads/feature/x');
    expect(merged).toContain('refs/heads/main');
  });

  it('excludes a branch with commits the given one does not have', async () =>
  {
    await runGit(repo, ['branch', 'ahead-of-main']);
    await runGit(repo, ['checkout', '-q', 'ahead-of-main']);
    await commit(repo, 'only on ahead-of-main');
    await runGit(repo, ['checkout', '-q', 'main']);

    const merged = await listMergedRefs(repo, 'HEAD');
    expect(merged).not.toContain('refs/heads/ahead-of-main');

    // …and from that branch's own tip, main is contained in it.
    const fromAhead = await listMergedRefs(repo, 'ahead-of-main');
    expect(fromAhead).toContain('refs/heads/main');

    await runGit(repo, ['branch', '-D', 'ahead-of-main']);
  });

  it('searches the remotes namespace too, since the panel marks those branches', async () =>
  {
    // Not from HEAD: `origin/main` is one commit *ahead* of local main in this fixture,
    // so HEAD does not contain it, which is the right answer and the reason this asks
    // from a commit that does. That it reports itself is also why `markMerged` drops
    // the refs pointing at the commit being asked about.
    const merged = await listMergedRefs(repo, 'origin/main');
    expect(merged).toContain('refs/remotes/origin/main');
  });

  it('leaves out a remote branch that is ahead of the commit asked about', async () =>
  {
    expect(await listMergedRefs(repo, 'HEAD')).not.toContain('refs/remotes/origin/main');
  });

  it('answers with an empty list for a commit that does not exist', async () =>
  {
    // A read that throws here would break the panel for a bad selection; an empty list
    // says "nothing is marked", which is the honest answer.
    expect(await listMergedRefs(repo, 'ffffffffffffffffffffffffffffffffffffffff')).toEqual([]);
  });
});

describe('listRemotes', () =>
{
  it('reads both remotes with their separate push URL', async () =>
  {
    expect(await listRemotes(repo)).toEqual([
      {
        name: 'origin',
        fetchUrl: origin,
        pushUrl: 'https://example.com/push.git',
        disabled: false
      },
      {
        name: 'upstream',
        fetchUrl: 'https://example.com/upstream.git',
        pushUrl: 'https://example.com/upstream.git',
        disabled: false
      }
    ]);
  });

  it('returns an empty list for a repository with no remotes', async () =>
  {
    const bare = join(root, 'no-remotes');
    await runGit(root, ['init', '-b', 'main', bare]);
    expect(await listRemotes(bare)).toEqual([]);
    expect(await getRemoteNames(bare)).toEqual([]);
  });
});

describe('listStashes', () =>
{
  it('lists the stack newest first, with branch and message', async () =>
  {
    const stashes = await listStashes(repo);
    expect(stashes.map((s) => [s.index, s.name, s.branch])).toEqual([
      [0, 'stash@{0}', 'main'],
      [1, 'stash@{1}', 'main']
    ]);
    // The named stash is the older one, and git keeps the message verbatim.
    expect(stashes[1]?.message).toContain('first stash');
    expect(stashes[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(stashes[0]?.date).toBeGreaterThan(0);
  });

  it('returns an empty list when nothing is stashed', async () =>
  {
    const empty = join(root, 'no-stash');
    await runGit(root, ['init', '-b', 'main', empty]);
    expect(await listStashes(empty)).toEqual([]);
  });
});

describe('listWorktrees', () =>
{
  it('lists the main worktree first, then the linked one', async () =>
  {
    const trees = await listWorktrees(repo);
    expect(trees.map((w) => [w.path, w.branch, w.isMain])).toEqual([
      [repo, 'main', true],
      [worktree, 'feature/x', false]
    ]);
  });

  it('reports the same list from inside the linked worktree', async () =>
  {
    const trees = await listWorktrees(worktree);
    expect(trees.map((w) => w.path)).toEqual([repo, worktree]);
  });

  it('flags a locked worktree and keeps its reason', async () =>
  {
    await runGit(repo, ['worktree', 'lock', '--reason', 'on a removable drive', worktree]);
    const locked = (await listWorktrees(repo)).find((w) => w.path === worktree);
    expect(locked).toMatchObject({ isLocked: true, lockReason: 'on a removable drive' });
    await runGit(repo, ['worktree', 'unlock', worktree]);
  });
});

describe('listSubmodules', () =>
{
  it('reads the declared submodule and sees it checked out', async () =>
  {
    const submodules = await listSubmodules(repo);
    expect(submodules).toHaveLength(1);
    expect(submodules[0]).toMatchObject({
      name: 'deps/lib',
      path: 'deps/lib',
      branch: null,
      initialized: true
    });
  });

  it('reports a declared but unpopulated submodule as uninitialized', async () =>
  {
    const clone = join(root, 'clone-no-submodules');
    await runGit(root, ['clone', repo, clone]);
    const submodules = await listSubmodules(clone);
    expect(submodules.map((s) => [s.path, s.initialized])).toEqual([['deps/lib', false]]);
  });

  it('returns an empty list when there is no .gitmodules', async () =>
  {
    const plain = join(root, 'no-submodules');
    await runGit(root, ['init', '-b', 'main', plain]);
    expect(await listSubmodules(plain)).toEqual([]);
  });
});

describe('submoduleStatus', () =>
{
  it('reports the recorded commit for a checked-out submodule', async () =>
  {
    const [entry] = await submoduleStatus(repo);
    expect(entry?.path).toBe('deps/lib');
    expect(entry?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(entry?.state).toBe('current');
  });

  it('reports one that has never been checked out as uninitialized', async () =>
  {
    // The `-` prefix, which is the whole reason for reading this rather than `.gitmodules`:
    // the declaration is identical either way.
    const clone = join(root, 'clone-no-submodules');
    const [entry] = await submoduleStatus(clone);
    expect(entry?.state).toBe('uninitialized');
  });

  it('is empty in a repository with no submodules', async () =>
  {
    expect(await submoduleStatus(join(root, 'no-submodules'))).toEqual([]);
  });
});
