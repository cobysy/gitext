/**
 * The dialog facts against real git.
 *
 * These reads exist to decide what a form says: how far a branch is, whether a reset
 * would be a fast-forward, whether a push would create a branch on the remote, whether a
 * name git will accept has been typed, which boxes to tick from config. Every one of them is a scalar parsed out of a
 * command's output, which is exactly the kind of thing that moves under a git upgrade,
 * so they are pinned against the real binary rather than a fixture.
 */

import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getAheadBehind,
  getConfigValues,
  getParentRevisions,
  getRevisionSummary,
  isAncestor,
  isValidBranchName,
  listRemoteHeads
} from '@main/git/facts.js';
import { runGit } from '@main/git/runner.js';

let root = '';
let repo = '';
let origin = '';
let empty = '';

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

/** A commit whose subject is the point of the test: same call, named for why. */
const commitWithSubject = commit;

beforeAll(async () =>
{
  // git canonicalizes paths; on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-facts-')));
  repo = join(root, 'repo');
  origin = join(root, 'origin.git');
  empty = join(root, 'empty');
  await mkdir(repo);
  await mkdir(empty);

  await runGit(root, ['init', '--bare', '-b', 'main', origin]);
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(empty, ['init', '-b', 'main']);
  await commit(repo, 'base');

  // `feature` is two commits past main; main gains one of its own afterwards, so the
  // two have diverged and both counts are non-zero.
  await runGit(repo, ['checkout', '-b', 'feature']);
  await commit(repo, 'feature one');
  await commit(repo, 'feature two');
  await runGit(repo, ['checkout', 'main']);
  await commit(repo, 'main one');

  // A branch that is strictly behind main, for the fast-forward case.
  await runGit(repo, ['branch', 'behind-only', 'HEAD~1']);

  await runGit(repo, ['remote', 'add', 'origin', origin]);
  await runGit(repo, ['push', 'origin', 'main', 'feature']);

  await runGit(repo, ['config', 'rebase.autosquash', 'true']);
  await runGit(repo, ['config', 'gitext.spaced', 'a value with spaces']);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('getAheadBehind', () =>
{
  it('counts both directions against a diverged branch', async () =>
  {
    // From HEAD (main): feature has two commits main does not, main has one feature
    // does not. Both numbers, from one revision walk.
    expect(await getAheadBehind(repo, 'feature')).toEqual({ ahead: 2, behind: 1 });
  });

  it('reads zero both ways for a ref that is where HEAD is', async () =>
  {
    expect(await getAheadBehind(repo, 'main')).toEqual({ ahead: 0, behind: 0 });
  });

  it('reports a strictly older branch as behind and not ahead', async () =>
  {
    expect(await getAheadBehind(repo, 'behind-only')).toEqual({ ahead: 0, behind: 1 });
  });

  it('takes an explicit base, so it can compare two refs neither of which is HEAD', async () =>
  {
    expect(await getAheadBehind(repo, 'feature', 'behind-only')).toEqual({
      ahead: 2,
      behind: 0
    });
  });

  it('answers null for a ref that does not exist', async () =>
  {
    expect(await getAheadBehind(repo, 'no-such-branch')).toBeNull();
  });

  it('answers null in a repository with no commits at all', async () =>
  {
    // An unborn HEAD cannot be one end of a range; a dialog opening on a fresh
    // repository must not fail over it.
    expect(await getAheadBehind(empty, 'main')).toBeNull();
  });
});

describe('isAncestor', () =>
{
  it('is true for a commit contained in another', async () =>
  {
    expect(await isAncestor(repo, 'behind-only', 'main')).toBe(true);
  });

  it('is true for a ref against itself', async () =>
  {
    expect(await isAncestor(repo, 'main', 'main')).toBe(true);
  });

  it('is false across a divergence: the reset would not be a fast-forward', async () =>
  {
    expect(await isAncestor(repo, 'main', 'feature')).toBe(false);
  });

  it('is false when a ref does not exist rather than throwing', async () =>
  {
    expect(await isAncestor(repo, 'no-such-branch', 'main')).toBe(false);
  });
});

describe('listRemoteHeads', () =>
{
  it('lists the remote branches by short name, without fetching', async () =>
  {
    const heads = await listRemoteHeads(repo, 'origin');
    expect([...heads].sort()).toEqual(['feature', 'main']);
  });

  it('answers an empty list for a remote that cannot be reached', async () =>
  {
    // Offline is not a reason for a dialog to refuse to open.
    await runGit(repo, ['remote', 'add', 'nowhere', join(root, 'does-not-exist.git')]);
    expect(await listRemoteHeads(repo, 'nowhere')).toEqual([]);
  });
});

describe('getConfigValues', () =>
{
  it('reads several keys in one answer', async () =>
  {
    expect(await getConfigValues(repo, ['rebase.autosquash'])).toEqual({
      'rebase.autosquash': 'true'
    });
  });

  it('leaves an unset key out rather than answering an empty string', async () =>
  {
    // Unset and false are different answers: git's own default is true for some keys
    // and false for others, and only the caller knows which.
    const values = await getConfigValues(repo, ['rebase.updaterefs', 'rebase.autosquash']);
    expect(values).toEqual({ 'rebase.autosquash': 'true' });
    expect('rebase.updaterefs' in values).toBe(false);
  });

  it('keeps a value with spaces intact', async () =>
  {
    expect(await getConfigValues(repo, ['gitext.spaced'])).toEqual({
      'gitext.spaced': 'a value with spaces'
    });
  });

  it('answers an empty record when nothing is asked', async () =>
  {
    expect(await getConfigValues(repo, [])).toEqual({});
  });
});

/**
 * Branch-name validity, asked of git rather than of a regex here.
 *
 * The rules are long and git owns them; every case below is one this app would otherwise
 * have had to encode, and would then have had to keep in step across git versions.
 */
describe('isValidBranchName', () =>
{
  it('accepts an ordinary name', async () =>
  {
    expect(await isValidBranchName(repo, 'feature/x')).toBe(true);
  });

  it('accepts a name that does not exist yet: this is format, not existence', async () =>
  {
    expect(await isValidBranchName(repo, 'nothing-points-here')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a space inside', 'feature x'],
    ['two dots', 'feature..x'],
    ['a leading dash', '-feature'],
    ['a trailing .lock', 'feature.lock'],
    ['a component starting with a dot', 'feature/.x'],
    ['an @{ sequence', 'feature@{1}'],
    ['a trailing slash', 'feature/']
  ])('refuses %s', async (_name, value) =>
  {
    expect(await isValidBranchName(repo, value)).toBe(false);
  });

  it('accepts the shorthands `--branch` mode expands, `@` among them', async () =>
  {
    // `check-ref-format --branch` is not purely a format check: it also resolves git's
    // own branch shorthands, so `@` (HEAD) and `@{-1}` (the previously checked-out
    // branch) pass. Worth pinning rather than discovering: a dialog that used this to
    // gate a *new* branch name would let `@` through, and `git branch @` then fails.
    expect(await isValidBranchName(repo, '@')).toBe(true);
  });
});

/**
 * What a revision is, for a dialog window that has no grid to look it up in.
 */
describe('getRevisionSummary', () =>
{
  it('describes a branch tip', async () =>
  {
    const summary = await getRevisionSummary(repo, 'main');
    expect(summary?.subject).toBe('main one');
    expect(summary?.author).toBe('Test');
    expect(summary?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(summary?.shortSha.length).toBeGreaterThanOrEqual(7);
    expect(summary?.sha.startsWith(summary.shortSha)).toBe(true);
    expect(summary?.date).toBeGreaterThan(0);
  });

  it('takes a full SHA and gives the same answer', async () =>
  {
    const byName = await getRevisionSummary(repo, 'main');
    expect(await getRevisionSummary(repo, byName!.sha)).toEqual(byName);
  });

  it('peels an annotated tag to the commit it points at', async () =>
  {
    // `show -s` on a tag object prints the *tag*: its tagger and its message, and no
    // subject at all. `log -1` peels, which is why this uses it: the thing being
    // checked out is the commit.
    await runGit(repo, [...IDENTITY, 'tag', '-a', 'v1.0', '-m', 'the release', 'main']);
    const summary = await getRevisionSummary(repo, 'v1.0');
    expect(summary?.subject).toBe('main one');
  });

  it('keeps a subject with awkward characters intact', async () =>
  {
    // On a branch of its own. The format is NUL-separated precisely so a subject cannot
    // break the parse, and moving `main` from the last test in a file is how a fixture
    // starts lying to the tests added after it.
    const subject = 'fix: a\tsubject "with" \u0027quotes\u0027 and | pipes';
    await runGit(repo, ['checkout', '-b', 'awkward-subject']);
    await commitWithSubject(repo, subject);
    await runGit(repo, ['checkout', 'main']);
    expect((await getRevisionSummary(repo, 'awkward-subject'))?.subject).toBe(subject);
  });

  it('is null for a revision that does not resolve', async () =>
  {
    expect(await getRevisionSummary(repo, 'no-such-thing')).toBeNull();
  });

  it('is null in a repository with no commits at all', async () =>
  {
    expect(await getRevisionSummary(empty, 'HEAD')).toBeNull();
  });
});

describe('getParentRevisions', () =>
{
  it('is empty for a root commit: there is nothing above it', async () =>
  {
    const root = (await runGit(repo, ['rev-list', '--max-parents=0', 'HEAD'])).trim();
    expect(await getParentRevisions(repo, root)).toEqual([]);
  });

  it('is one entry for an ordinary commit', async () =>
  {
    const parents = await getParentRevisions(repo, 'main');
    expect(parents).toHaveLength(1);
    expect(parents[0]?.subject).toBe('base');
  });

  it('describes both parents of a merge, in git\'s order', async () =>
  {
    // The order is the whole point: `-m` counts these 1-based, so a list that came back
    // sorted by date would make `-m 1` mean the other side of the merge.
    await runGit(repo, ['checkout', '-b', 'merge-host', 'main']);
    await runGit(repo, [...IDENTITY, 'merge', '--no-ff', '-m', 'the merge', 'feature']);

    const parents = await getParentRevisions(repo, 'merge-host');
    expect(parents).toHaveLength(2);
    expect(parents[0]?.subject).toBe('main one');
    expect(parents[1]?.subject).toBe('feature two');

    // And each is the same commit `getRevisionSummary` describes, so the dialog's list
    // and its summary cannot disagree.
    expect(parents[0]).toEqual(await getRevisionSummary(repo, 'main'));

    await runGit(repo, ['checkout', 'main']);
  });

  it('is empty for a revision that does not resolve', async () =>
  {
    expect(await getParentRevisions(repo, 'no-such-thing')).toEqual([]);
  });

  it('is empty in a repository with no commits at all', async () =>
  {
    expect(await getParentRevisions(empty, 'HEAD')).toEqual([]);
  });
});
