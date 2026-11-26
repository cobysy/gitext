/**
 * `listStaleBranches` against the real git binary.
 *
 * The whole feature turns on one claim: that a squash-merged branch can be told apart
 * from a branch with unlanded work. Both look identical to `git branch --merged`, and
 * getting it wrong deletes someone's work with `-D`. So the fixture builds all four
 * cases against real git rather than asserting on a parser.
 */

import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listStaleBranches } from '@main/git/branchCleanup.js';
import { listRefs } from '@main/git/refs.js';
import { REF_KIND_BRANCH, type GitCommandRecord } from '@shared/types.js';
import { runGit, runnerEvents } from '@main/git/runner.js';

let root = '';
let repo = '';

const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

async function commitFile(name: string, body: string, message: string): Promise<void>
{
  await writeFile(join(repo, name), body, 'utf8');
  await runGit(repo, ['add', '--', name]);
  await runGit(repo, [...IDENTITY, 'commit', '-m', message]);
}

beforeAll(async () =>
{
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-cleanup-')));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', 'repo']);

  await commitFile('base.txt', 'base\n', 'base');

  // 1. A branch merged the ordinary way: ancestry links it to main.
  await runGit(repo, ['checkout', '-b', 'merged-normally']);
  await commitFile('normal.txt', 'normal\n', 'normal work');
  await runGit(repo, ['checkout', 'main']);
  await runGit(repo, [...IDENTITY, 'merge', '--no-ff', 'merged-normally', '-m', 'merge']);

  // 2. A branch squash-merged: its content is on main under a brand-new commit that
  //    has no ancestry link back, which is exactly what `--merged` cannot see.
  //    Two commits, so the naive per-commit `git cherry` check cannot match either.
  await runGit(repo, ['checkout', '-b', 'squashed-away']);
  await commitFile('squash.txt', 'one\n', 'part one');
  await commitFile('squash.txt', 'one\ntwo\n', 'part two');
  await runGit(repo, ['checkout', 'main']);
  await runGit(repo, ['merge', '--squash', 'squashed-away']);
  await runGit(repo, [...IDENTITY, 'commit', '-m', 'squashed: the whole branch at once']);

  // 3. A branch with work that never landed anywhere.
  await runGit(repo, ['checkout', '-b', 'still-working']);
  await commitFile('wip.txt', 'wip\n', 'unfinished');

  await runGit(repo, ['checkout', 'main']);
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('listStaleBranches', () =>
{
  it('judges a branch by the branch, never by a tag of the same name', async () =>
  {
    // The tag is on work that did land, squashed: git resolves a bare `release` as the
    // tag before the branch, and the tag's content is on main.
    await runGit(repo, ['checkout', '-b', 'release']);
    await commitFile('release.txt', 'unreleased\n', 'release work');
    await runGit(repo, ['checkout', 'main']);
    await runGit(repo, ['tag', 'release', 'squashed-away']);
    try
    {
      const { stale, keptBack } = await listStaleBranches(repo, 'main');
      expect(stale.map((b) => b.name)).not.toContain('release');
      expect(keptBack.find((k) => k.name === 'release')?.why).toContain('not on main');
    }
    finally
    {
      await runGit(repo, ['tag', '-d', 'release']);
      await runGit(repo, ['branch', '-D', 'release']);
    }
  });

  it('judges against the comparison branch, never a tag of the same name', async () =>
  {
    // A tag `main` on the first commit: read in place of the branch, nothing after it
    // would be merged, and the normally-merged branch would be kept back.
    const first = (await runGit(repo, ['rev-list', '--max-parents=0', 'main'])).trim();
    await runGit(repo, ['tag', 'main', first]);
    try
    {
      const { stale } = await listStaleBranches(repo, 'main');
      expect(stale.find((b) => b.name === 'merged-normally')?.reason).toBe('contained');
      expect(stale.find((b) => b.name === 'squashed-away')?.reason).toBe('squashed');
    }
    finally
    {
      await runGit(repo, ['tag', '-d', 'main']);
    }
  });

  it('stops a squash test between its git calls once the scan is abandoned', async () =>
  {
    // Abandoned the moment the first squash test starts: every test in flight must stop
    // before its next call rather than run its chain of four out.
    const scan = new AbortController();
    const commands: string[] = [];
    function watch(record: GitCommandRecord): void
    {
      if (record.cwd !== repo || record.exitCode !== null)
      {
        return;
      }
      commands.push(record.argv[0]!);
      if (record.argv[0] === 'merge-base')
      {
        scan.abort();
      }
    }
    runnerEvents.on('record', watch);
    try
    {
      await expect(listStaleBranches(repo, 'main', { signal: scan.signal })).rejects.toThrow();
    }
    finally
    {
      runnerEvents.off('record', watch);
    }
    expect(commands).toContain('merge-base');
    expect(commands).not.toContain('rev-parse');
    expect(commands).not.toContain('commit-tree');
    expect(commands).not.toContain('cherry');
  });

  it('offers a normally-merged branch as contained', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.find((b) => b.name === 'merged-normally')?.reason).toBe('contained');
  });

  it('reports each local branch as it is judged, counting up to all of them', async () =>
  {
    const seen: { checked: number; total: number }[] = [];
    await listStaleBranches(repo, 'main', { onProgress: (progress) => seen.push(progress) });
    const locals = (await listRefs(repo)).filter((ref) => ref.kind === REF_KIND_BRANCH);
    expect(seen.map((p) => p.checked)).toEqual(locals.map((_, index) => index + 1));
    expect(seen.every((p) => p.total === locals.length)).toBe(true);
  });

  it('judges nothing once its signal has fired, and rejects', async () =>
  {
    // How far a scan gets before stopping is `mapLimited`'s to prove: this fixture has
    // fewer branches than the scan judges at once, so every one is in flight from the start.
    const scan = new AbortController();
    scan.abort();
    const seen: number[] = [];
    const answer = listStaleBranches(repo, 'main', {
      signal: scan.signal,
      onProgress: ({ checked }) => seen.push(checked)
    });
    await expect(answer).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it('offers a squash-merged branch, which git itself cannot see is merged', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.find((b) => b.name === 'squashed-away')?.reason).toBe('squashed');
  });

  it('git agrees the squashed branch is not merged, which is why -D is needed', async () =>
  {
    // Pins the premise of the whole feature. If a future git learns to see squash
    // merges, `--merged` would list it and this test says so loudly rather than the
    // classifier quietly changing its answer.
    const merged = await runGit(repo, ['branch', '--merged', 'main', '--format=%(refname:short)']);
    expect(merged.split('\n').map((l) => l.trim())).not.toContain('squashed-away');
  });

  it('never offers a branch whose work has not landed', async () =>
  {
    const { stale, keptBack } = await listStaleBranches(repo, 'main');
    expect(stale.map((b) => b.name)).not.toContain('still-working');
    expect(keptBack.find((k) => k.name === 'still-working')?.why).toContain('not on main');
  });

  it('keeps back the checked-out branch rather than offering it', async () =>
  {
    await runGit(repo, ['checkout', 'still-working']);
    try
    {
      const { stale, keptBack } = await listStaleBranches(repo, 'main');
      expect(stale.map((b) => b.name)).not.toContain('still-working');
      expect(keptBack.find((k) => k.name === 'still-working')?.why).toBe('the current branch');
    }
    finally
    {
      await runGit(repo, ['checkout', 'main']);
    }
  });

  it('never offers the comparison branch itself', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.map((b) => b.name)).not.toContain('main');
  });

  it('counts every local branch it examined', async () =>
  {
    const { examined } = await listStaleBranches(repo, 'main');
    // main, merged-normally, squashed-away, still-working
    expect(examined).toBe(4);
  });

  it('lets git verify a merged branch HEAD contains, with -d', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.find((b) => b.name === 'merged-normally')?.needsForce).toBe(false);
  });

  it('needs -D for a squash-merged branch, whatever HEAD holds', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.find((b) => b.name === 'squashed-away')?.needsForce).toBe(true);
  });

  it('needs -D for a merged branch while HEAD is behind the comparison', async () =>
  {
    await runGit(repo, ['checkout', '--detach', 'main~2']);
    try
    {
      const { stale } = await listStaleBranches(repo, 'main');
      expect(stale.find((b) => b.name === 'merged-normally')?.needsForce).toBe(true);
      // The premise: `-d` judges against HEAD, not against the comparison, and refuses.
      const refused = await runGit(repo, ['branch', '-d', 'merged-normally']).then(
        () => false,
        () => true
      );
      expect(refused).toBe(true);
    }
    finally
    {
      await runGit(repo, ['checkout', 'main']);
    }
  });

  describe('against a remote-tracking comparison', () =>
  {
    beforeAll(async () =>
    {
      await runGit(repo, ['remote', 'add', 'origin', join(root, 'nowhere.git')]);
      await runGit(repo, ['update-ref', 'refs/remotes/origin/main', 'main']);
      await runGit(repo, ['branch', 'tracks-origin', 'main~1']);
      await runGit(repo, ['branch', '--set-upstream-to', 'origin/main', 'tracks-origin']);
    });

    afterAll(async () =>
    {
      await runGit(repo, ['branch', '-D', 'tracks-origin']);
      await runGit(repo, ['remote', 'remove', 'origin']);
    });

    it('keeps back the local copy of the comparison rather than offering it', async () =>
    {
      const { stale, keptBack } = await listStaleBranches(repo, 'origin/main');
      expect(stale.map((b) => b.name)).not.toContain('main');
      expect(keptBack.find((k) => k.name === 'main')?.why).toBe('the local copy of origin/main');
    });

    it('judges a branch with a live upstream against that upstream', async () =>
    {
      await runGit(repo, ['checkout', '--detach', 'main~2']);
      try
      {
        const { stale } = await listStaleBranches(repo, 'origin/main');
        expect(stale.find((b) => b.name === 'tracks-origin')?.needsForce).toBe(false);
        expect(stale.find((b) => b.name === 'merged-normally')?.needsForce).toBe(true);
      }
      finally
      {
        await runGit(repo, ['checkout', 'main']);
      }
    });
  });

  it('leaves the branches themselves alone: it only reports', async () =>
  {
    const before = await runGit(repo, ['branch', '--format=%(refname:short)']);
    await listStaleBranches(repo, 'main');
    const after = await runGit(repo, ['branch', '--format=%(refname:short)']);
    expect(after).toBe(before);
  });
});
