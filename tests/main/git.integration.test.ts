/**
 * Integration tests for the git layer.
 *
 * These drive the real `git` binary against throwaway repositories in a temp dir.
 * Nothing is mocked: if these pass, the wrappers work against the git the user
 * actually has.
 */

import { mkdtemp, rm, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCommitMessage } from '@main/git/facts.js';
import { getRepoInfo, getRepoState, getStatus, resolveWatchedGitDirs } from '@main/git/repo.js';
import { listRemotes, setRemoteEnabled } from '@main/git/remote.js';
import {
  clearCommandLog,
  formatCommand,
  getCommandLog,
  runGit,
  runnerEvents,
  tryGit
} from '@main/git/runner.js';

let root = '';
let repo = '';

/** Commit identity, so these tests do not depend on the machine's git config. */
const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

async function commit(message: string): Promise<void>
{
  await runGit(repo, [...IDENTITY, 'commit', '-m', message]);
}

beforeAll(async () =>
{
  // git reports the canonical path from `rev-parse --show-toplevel`, so resolve
  // symlinks up front: on macOS /var is a symlink to /private/var and the paths
  // would otherwise never compare equal.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-test-')));
  repo = join(root, 'repo');
  await mkdir(repo);

  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'a.txt'), 'hello\n');
  await runGit(repo, ['add', 'a.txt']);
  await commit('initial commit');
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('getRepoInfo', () =>
{
  it('identifies a working tree', async () =>
  {
    const info = await getRepoInfo(repo);
    expect(info).toMatchObject({ name: 'repo', branch: 'main', isBare: false });
    expect(info?.head).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('resolves a subdirectory to the working tree root', async () =>
  {
    const sub = join(repo, 'nested', 'deep');
    await mkdir(sub, { recursive: true });
    const info = await getRepoInfo(sub);
    expect(info?.path).toBe(repo);
  });

  it('returns null outside a repository', async () =>
  {
    expect(await getRepoInfo(root)).toBeNull();
  });

  it('returns null for a path that does not exist', async () =>
  {
    expect(await getRepoInfo(join(root, 'nope'))).toBeNull();
  });

  /**
   * `rev-parse --show-toplevel` is *fatal* in a bare repository, not empty, so asking it
   * first made every bare repository read as "not a repository at all" and sent the
   * window to the welcome screen.
   */
  it('identifies a bare repository', async () =>
  {
    const bare = join(root, 'bare.git');
    await runGit(root, ['clone', '--bare', repo, bare]);

    const info = await getRepoInfo(bare);
    expect(info).not.toBeNull();
    expect(info).toMatchObject({ name: 'bare.git', path: bare, isBare: true });
    expect(info?.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(info?.gitDir).toBe(bare);
  });

  it('reports a detached HEAD as a null branch', async () =>
  {
    const clone = join(root, 'detached');
    await runGit(root, ['clone', repo, clone]);
    const sha = (await runGit(clone, ['rev-parse', 'HEAD'])).trim();
    await runGit(clone, ['checkout', '--detach', sha]);

    const info = await getRepoInfo(clone);
    expect(info?.branch).toBeNull();
    expect(info?.head).not.toBeNull();
  });
});

describe('resolveWatchedGitDirs', () =>
{
  it('names one directory for an ordinary clone', async () =>
  {
    expect(await resolveWatchedGitDirs(repo)).toEqual([join(repo, '.git')]);
  });

  /**
   * The regression: watching a linked worktree's own directory alone leaves refs,
   * `config` and `packed-refs` unwatched, so nothing done outside the app ever showed up.
   */
  it('names both directories inside a linked worktree', async () =>
  {
    const tree = join(root, 'linked');
    await runGit(repo, ['worktree', 'add', '-b', 'linked-branch', tree]);

    expect(await resolveWatchedGitDirs(tree)).toEqual([
      join(repo, '.git', 'worktrees', 'linked'),
      join(repo, '.git')
    ]);
  });
});

describe('getStatus', () =>
{
  it('reports a clean tree as having no files', async () =>
  {
    const status = await getStatus(repo);
    expect(status.branch).toBe('main');
    expect(status.files).toEqual([]);
  });

  it('separates staged from unstaged changes', async () =>
  {
    await writeFile(join(repo, 'staged.txt'), 'staged\n');
    await runGit(repo, ['add', 'staged.txt']);
    await writeFile(join(repo, 'a.txt'), 'modified\n');

    const status = await getStatus(repo);
    const byPath = new Map(status.files.map((f) => [f.path, f]));

    expect(byPath.get('staged.txt')).toMatchObject({ staged: true, index: 'added' });
    expect(byPath.get('a.txt')).toMatchObject({ unstaged: true, worktree: 'modified' });

    // Leave the tree as we found it for the tests that follow.
    await runGit(repo, ['reset', '--hard', 'HEAD']);
    await rm(join(repo, 'staged.txt'), { force: true });
  });

  it('reports untracked files', async () =>
  {
    await writeFile(join(repo, 'untracked.txt'), 'new\n');
    const status = await getStatus(repo);
    expect(status.files).toContainEqual(
      expect.objectContaining({ path: 'untracked.txt', worktree: 'untracked' })
    );
    await rm(join(repo, 'untracked.txt'));
  });

  it('handles paths containing spaces', async () =>
  {
    const name = 'a file with spaces.txt';
    await writeFile(join(repo, name), 'x\n');
    const status = await getStatus(repo);
    expect(status.files.map((f) => f.path)).toContain(name);
    await rm(join(repo, name));
  });

  it('reports ahead/behind against an upstream', async () =>
  {
    const clone = join(root, 'tracking');
    await runGit(root, ['clone', repo, clone]);
    await writeFile(join(clone, 'local.txt'), 'local\n');
    await runGit(clone, ['add', 'local.txt']);
    await runGit(clone, [...IDENTITY, 'commit', '-m', 'local change']);

    const status = await getStatus(clone);
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(0);
    expect(status.upstream).toBeTruthy();
  });
});

describe('getRepoState', () =>
{
  it('reports a quiet repository as idle', async () =>
  {
    const state = await getRepoState(repo);
    expect(state).toMatchObject({ operation: 'none', conflictCount: 0 });
  });

  it('detects a conflicted merge and lists the conflicted paths', async () =>
  {
    const conflict = join(root, 'conflict');
    await mkdir(conflict);
    await runGit(conflict, ['init', '-b', 'main']);
    await writeFile(join(conflict, 'f.txt'), 'base\n');
    await runGit(conflict, ['add', 'f.txt']);
    await runGit(conflict, [...IDENTITY, 'commit', '-m', 'base']);

    await runGit(conflict, ['checkout', '-b', 'other']);
    await writeFile(join(conflict, 'f.txt'), 'theirs\n');
    await runGit(conflict, ['add', 'f.txt']);
    await runGit(conflict, [...IDENTITY, 'commit', '-m', 'theirs']);

    await runGit(conflict, ['checkout', 'main']);
    await writeFile(join(conflict, 'f.txt'), 'ours\n');
    await runGit(conflict, ['add', 'f.txt']);
    await runGit(conflict, [...IDENTITY, 'commit', '-m', 'ours']);

    // Expected to fail: that is the conflict we are testing for.
    await expect(runGit(conflict, [...IDENTITY, 'merge', 'other'])).rejects.toThrow();

    const state = await getRepoState(conflict);
    expect(state.operation).toBe('merge');
    expect(state.conflictCount).toBe(1);
    expect(state.conflictedPaths).toEqual(['f.txt']);
  });

  it('detects an interrupted rebase', async () =>
  {
    const rebase = join(root, 'rebase');
    await mkdir(rebase);
    await runGit(rebase, ['init', '-b', 'main']);
    await writeFile(join(rebase, 'f.txt'), 'base\n');
    await runGit(rebase, ['add', 'f.txt']);
    await runGit(rebase, [...IDENTITY, 'commit', '-m', 'base']);

    await runGit(rebase, ['checkout', '-b', 'topic']);
    await writeFile(join(rebase, 'f.txt'), 'topic\n');
    await runGit(rebase, ['add', 'f.txt']);
    await runGit(rebase, [...IDENTITY, 'commit', '-m', 'topic']);

    await runGit(rebase, ['checkout', 'main']);
    await writeFile(join(rebase, 'f.txt'), 'main\n');
    await runGit(rebase, ['add', 'f.txt']);
    await runGit(rebase, [...IDENTITY, 'commit', '-m', 'main']);

    await expect(runGit(rebase, [...IDENTITY, 'rebase', 'topic'])).rejects.toThrow();

    const state = await getRepoState(rebase);
    expect(state.operation).toBe('rebase');
    expect(state.conflictCount).toBeGreaterThan(0);
  });
});

describe('runner', () =>
{
  it('rejects with git stderr rather than a generic message', async () =>
  {
    await expect(runGit(repo, ['checkout', 'no-such-branch'])).rejects.toThrow(/no-such-branch/);
  });

  it('resolves to null via tryGit instead of throwing', async () =>
  {
    expect(await tryGit(repo, ['rev-parse', 'no-such-ref'])).toBeNull();
  });

  it('records every invocation in the command log', async () =>
  {
    clearCommandLog();
    await runGit(repo, ['rev-parse', 'HEAD']);

    const records = getCommandLog();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ argv: ['rev-parse', 'HEAD'], exitCode: 0, running: false });
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records failures with their exit code and stderr', async () =>
  {
    clearCommandLog();
    await expect(runGit(repo, ['checkout', 'nope'])).rejects.toThrow();

    const record = getCommandLog()[0];
    expect(record?.exitCode).not.toBe(0);
    expect(record?.stderr).toContain('nope');
  });

  it('emits a start record and a completion record for the same id', async () =>
  {
    const seen: { id: number; running: boolean }[] = [];
    const listener = (r: { id: number; running: boolean }): void =>
    {
      seen.push({ id: r.id, running: r.running });
    };
    runnerEvents.on('record', listener);

    await runGit(repo, ['rev-parse', 'HEAD']);
    runnerEvents.off('record', listener);

    // Two at least, and more when output arrived along the way: a command republishes
    // as it prints, so the log shows what it is saying rather than only what it said.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const last = seen[seen.length - 1];
    expect(seen[0]?.running).toBe(true);
    expect(last?.running).toBe(false);
    expect(seen.slice(0, -1).every((r) => r.running)).toBe(true);
    expect(seen.every((r) => r.id === seen[0]?.id)).toBe(true);
  });

  it('classifies reads and writes so background polling can skip the index lock', async () =>
  {
    clearCommandLog();
    await runGit(repo, ['status', '--porcelain=v2', '-z']);
    await runGit(repo, ['config', 'gitext.marker', 'x'], { kind: 'write' });

    const [read, write] = getCommandLog();
    expect(read?.kind).toBe('read');
    expect(write?.kind).toBe('write');
  });

  it('passes arguments through verbatim, with no shell interpretation', async () =>
  {
    // A filename that a shell would mangle proves argv is passed directly.
    const tricky = "weird name $(echo hi) 'quoted'.txt";
    await writeFile(join(repo, tricky), 'x\n');

    const status = await getStatus(repo);
    expect(status.files.map((f) => f.path)).toContain(tricky);

    await rm(join(repo, tricky));
  });
});

describe('formatCommand', () =>
{
  it('leaves safe arguments unquoted', () =>
  {
    expect(formatCommand(['merge', '--no-ff', 'feature/x'])).toBe('git merge --no-ff feature/x');
  });

  it('quotes arguments containing spaces', () =>
  {
    expect(formatCommand(['commit', '-m', 'a message'])).toBe("git commit -m 'a message'");
  });

  it('escapes embedded single quotes so the output is paste-safe', () =>
  {
    expect(formatCommand(['commit', '-m', "it's"])).toBe("git commit -m 'it'\\''s'");
  });
});

/**
 * Activating and deactivating a remote against real git.
 *
 * Worth driving for real rather than unit-testing the argv: this is the one operation in
 * the app that git has no command for. It renames a whole config section by reading every
 * key, writing them under the other name and removing the original, and the failure mode
 * of getting it wrong is a remote that has lost its URL, which no amount of argv-shape
 * assertion would catch.
 */
describe('setRemoteEnabled', () =>
{
  it('moves the section out of git’s sight and back, keeping every key', async () =>
  {
    await runGit(repo, ['remote', 'add', 'fork', 'https://example.com/fork.git']);
    await runGit(repo, [
      'config',
      'remote.fork.pushurl',
      'ssh://git@example.com/fork.git'
    ]);

    await setRemoteEnabled(repo, 'fork', false);

    // git no longer knows it exists…
    expect(await tryGit(repo, ['remote'])).not.toContain('fork');
    // …but the panel still does, with both URLs intact.
    const off = await listRemotes(repo);
    expect(off.find((entry) => entry.name === 'fork')).toEqual({
      name: 'fork',
      fetchUrl: 'https://example.com/fork.git',
      pushUrl: 'ssh://git@example.com/fork.git',
      disabled: true
    });

    await setRemoteEnabled(repo, 'fork', true);

    expect(await tryGit(repo, ['remote'])).toContain('fork');
    expect((await listRemotes(repo)).find((entry) => entry.name === 'fork')).toMatchObject({
      pushUrl: 'ssh://git@example.com/fork.git',
      disabled: false
    });

    await runGit(repo, ['remote', 'remove', 'fork']);
  });

  // The multi-valued keys are the trap: a remote has a `fetch` refspec line per branch it
  // tracks, and writing them back with `git config <key> <value>` rather than `--add`
  // fails on the second one with "cannot overwrite multiple values".
  it('keeps every value of a multi-valued key', async () =>
  {
    await runGit(repo, ['remote', 'add', 'multi', 'https://example.com/m.git']);
    await runGit(repo, [
      'config',
      '--add',
      'remote.multi.fetch',
      '+refs/pull/*/head:refs/remotes/multi/pr/*'
    ]);

    await setRemoteEnabled(repo, 'multi', false);
    await setRemoteEnabled(repo, 'multi', true);

    const refspecs = await tryGit(repo, ['config', '--get-all', 'remote.multi.fetch']);
    expect(refspecs?.split('\n').filter(Boolean)).toHaveLength(2);

    await runGit(repo, ['remote', 'remove', 'multi']);
  });

  it('does nothing at all for a remote that is not there', async () =>
  {
    await setRemoteEnabled(repo, 'ghost', false);
    expect((await listRemotes(repo)).map((entry) => entry.name)).not.toContain('ghost');
  });
});

/**
 * Rewording a commit, against real git.
 *
 * `renderer/model/args/reword.ts` builds these argv and its unit test pins their shape;
 * what it cannot show is that they *work*: that `--only` really does leave staged work
 * alone, that `--autosquash` really does match an `amend!` marker by subject and replace
 * the message, and that the whole thing runs without an editor. Every one of those was
 * an assumption when the table was written, and one of them (`--fixup=reword:` taking a
 * `-m`) turned out to be wrong, which is why this block exists.
 *
 * Its own repository: rewording rewrites history, and the shared one above is walked by
 * every other test in this file.
 */
describe('rewording a commit', () =>
{
  let reword = '';

  /** The argv the renderer builds, kept in the shape `buildRewordSteps` returns. */
  const amendHead = (message: string): string[] => ['commit', '--amend', '--only', '-m', message];
  const markerFor = (subject: string, message: string): string[] => [
    'commit',
    '--only',
    '--allow-empty',
    '-m',
    `amend! ${subject}`,
    '-m',
    message
  ];
  const autosquash = (sha: string): string[] => [
    'rebase',
    '-i',
    '--autosquash',
    '--autostash',
    `${sha}^`
  ];

  const messageOf = async (rev: string): Promise<string> =>
    (await runGit(reword, ['log', '-1', '--format=%B', rev, '--'])).replace(/\n+$/, '');
  const subjectsOf = async (): Promise<string[]> =>
    (await runGit(reword, ['log', '--format=%s'])).trim().split('\n');

  beforeAll(async () =>
  {
    reword = join(root, 'reword');
    await mkdir(reword);
    await runGit(reword, ['init', '-b', 'main']);
    for (const name of ['one', 'two', 'three'])
    {
      await writeFile(join(reword, `${name}.txt`), `${name}\n`);
      await runGit(reword, ['add', `${name}.txt`]);
      await runGit(reword, [...IDENTITY, 'commit', '-m', `Commit ${name}`]);
    }
  });

  it('rewords HEAD without touching what is staged', async () =>
  {
    await writeFile(join(reword, 'staged.txt'), 'work in progress\n');
    await runGit(reword, ['add', 'staged.txt']);

    await runGit(reword, [...IDENTITY, ...amendHead('Commit three, reworded')]);

    expect(await messageOf('HEAD')).toBe('Commit three, reworded');
    // The half that matters: `--only` kept the staged file out of the commit, and kept it
    // staged. Without it the user's work in progress would have been committed silently.
    const committed = await runGit(reword, ['show', '--name-only', '--format=', 'HEAD']);
    expect(committed).not.toContain('staged.txt');
    expect(await runGit(reword, ['diff', '--cached', '--name-only'])).toContain('staged.txt');

    await runGit(reword, ['reset', '-q', 'HEAD', '--', 'staged.txt']);
    await rm(join(reword, 'staged.txt'));
  });

  it('rewords an older commit through an amend! marker and an autosquash rebase', async () =>
  {
    const target = (await runGit(reword, ['rev-parse', 'HEAD~1'])).trim();
    const subject = (await runGit(reword, ['log', '-1', '--format=%s', target])).trim();
    const before = await subjectsOf();

    await runGit(reword, [...IDENTITY, ...markerFor(subject, 'Commit two, reworded')]);
    // The marker is an ordinary empty commit until the rebase folds it in.
    expect(await messageOf('HEAD')).toBe(`amend! ${subject}\n\nCommit two, reworded`);

    await runGit(reword, [...IDENTITY, ...autosquash(target)]);

    // Same number of commits: the marker was consumed, not left behind.
    const after = await subjectsOf();
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(['Commit three, reworded', 'Commit two, reworded', 'Commit one']);
  });

  it('replaces the body rather than appending to it', async () =>
  {
    await writeFile(join(reword, 'four.txt'), 'four\n');
    await runGit(reword, ['add', 'four.txt']);
    await runGit(reword, [...IDENTITY, 'commit', '-m', 'Has a body\n\nthe old body']);
    await writeFile(join(reword, 'five.txt'), 'five\n');
    await runGit(reword, ['add', 'five.txt']);
    await runGit(reword, [...IDENTITY, 'commit', '-m', 'On top']);

    const target = (await runGit(reword, ['rev-parse', 'HEAD~1'])).trim();
    await runGit(reword, [...IDENTITY, ...markerFor('Has a body', 'New subject\n\nnew body')]);
    await runGit(reword, [...IDENTITY, ...autosquash(target)]);

    // A reword is a replacement, not an addition: the old body must be gone.
    const message = await messageOf('HEAD~1');
    expect(message).toBe('New subject\n\nnew body');
    expect(message).not.toContain('the old body');
  });

  it('carries an uncommitted change across the rebase', async () =>
  {
    // `--autostash`: a dirty tree is the normal state to be in when you notice a bad
    // message, and a reword that refused until you stashed would be one nobody uses.
    await writeFile(join(reword, 'one.txt'), 'edited while rewording\n');

    const target = (await runGit(reword, ['rev-parse', 'HEAD~1'])).trim();
    const subject = (await runGit(reword, ['log', '-1', '--format=%s', target])).trim();
    await runGit(reword, [...IDENTITY, ...markerFor(subject, 'Reworded with a dirty tree')]);
    await runGit(reword, [...IDENTITY, ...autosquash(target)]);

    expect(await messageOf('HEAD~1')).toBe('Reworded with a dirty tree');
    expect(await runGit(reword, ['diff', '--name-only'])).toContain('one.txt');

    await runGit(reword, ['checkout', '--', 'one.txt']);
  });

  it('getCommitMessage reads the whole message, without git log trailing newline', async () =>
  {
    await runGit(reword, [...IDENTITY, ...amendHead('Subject\n\nBody line one\nBody line two')]);
    expect(await getCommitMessage(reword, 'HEAD')).toBe(
      'Subject\n\nBody line one\nBody line two'
    );
  });

  it('getCommitMessage answers empty for a revision that does not resolve', async () =>
  {
    expect(await getCommitMessage(reword, 'no-such-ref')).toBe('');
  });
});
