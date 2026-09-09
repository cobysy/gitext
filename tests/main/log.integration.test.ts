/**
 * The log reader against real git, including the cases that only show up with a
 * real repository: incremental delivery across process chunk boundaries, and
 * messages containing the characters a newline-based parser would choke on.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCommitDetails } from '@main/git/commitDetails.js';
import { buildLogArgs, readLog, streamLog } from '@main/git/log.js';
import { getRemoteNames } from '@main/git/remote.js';
import type { CommitRow } from '@shared/types.js';

let repo: string;

function git(...args: string[]): string
{
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

describe('log against real git', () =>
{
  beforeAll(async () =>
  {
    // git canonicalizes paths; on macOS /var is a symlink to /private/var.
    repo = await realpath(await mkdtemp(join(tmpdir(), 'gitext-log-')));

    git('init', '-q', '-b', 'main', '.');
    git('config', 'user.email', 'ada@example.com');
    git('config', 'user.name', 'Ada Lovelace');

    const commit = (message: string): void =>
    {
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], { cwd: repo });
    };

    commit('first commit');
    commit('subject line\n\nbody paragraph one\n\nbody paragraph two');
    commit('a message with, commas and "quotes" and a | pipe');
    git('tag', 'v1.0');
    git('checkout', '-q', '-b', 'feature/graph');
    commit('on a branch whose name contains a slash');
  });

  afterAll(async () =>
  {
    await rm(repo, { recursive: true, force: true });
  });

  it('reads commits newest first', async () =>
  {
    const commits = await readLog(repo, { scope: 'all' });

    expect(commits.length).toBe(4);
    expect(commits[0]!.subject).toBe('on a branch whose name contains a slash');
    expect(commits[commits.length - 1]!.subject).toBe('first commit');
  });

  it('keeps a multi-paragraph body intact', async () =>
  {
    const commits = await readLog(repo, { scope: 'all' });
    const commit = commits.find((c) => c.subject === 'subject line')!;

    expect(commit.body).toBe('body paragraph one\n\nbody paragraph two');
  });

  it('reads a message containing commas, quotes and pipes', async () =>
  {
    const commits = await readLog(repo, { scope: 'all' });
    const subjects = commits.map((c) => c.subject);

    expect(subjects).toContain('a message with, commas and "quotes" and a | pipe');
  });

  it('reports the author and a usable timestamp', async () =>
  {
    const [commit] = await readLog(repo, { limit: 1, scope: 'all' });

    expect(commit!.authorName).toBe('Ada Lovelace');
    expect(commit!.authorEmail).toBe('ada@example.com');
    // Seconds, not milliseconds: a plausible recent date, not 1970.
    expect(commit!.authorDate).toBeGreaterThan(1_600_000_000);
    expect(commit!.authorDate).toBeLessThan(4_000_000_000);
  });

  it('decodes the current branch and a tag', async () =>
  {
    const commits = await readLog(repo, { scope: 'all' });

    const head = commits.find((c) => c.refs.some((r) => r.isCurrent))!;
    expect(head.refs.find((r) => r.isCurrent)!.name).toBe('feature/graph');

    const tagged = commits.find((c) => c.refs.some((r) => r.kind === 'tag'))!;
    expect(tagged.refs.find((r) => r.kind === 'tag')!.name).toBe('v1.0');
  });

  it('honours the commit limit', async () =>
  {
    expect(await readLog(repo, { limit: 2, scope: 'all' })).toHaveLength(2);
  });

  it('links every commit to its parent', async () =>
  {
    const commits = await readLog(repo, { scope: 'all' });

    for (let i = 0; i < commits.length - 1; i++)
    {
      expect(commits[i]!.parents).toContain(commits[i + 1]!.sha);
    }
    // The first commit is a root.
    expect(commits[commits.length - 1]!.parents).toEqual([]);
  });

  it('streams the same commits it would buffer', async () =>
  {
    const batches: CommitRow[][] = [];
    const { done } = streamLog(repo, { scope: 'all' }, (batch) => batches.push(batch));
    await done;
    // The batches are the whole answer: `done` carries no commits, deliberately.
    const streamed = batches.flat();
    const buffered = await readLog(repo, { scope: 'all' });

    expect(streamed.map((c) => c.sha)).toEqual(buffered.map((c) => c.sha));
    expect(streamed.length).toBeGreaterThan(0);
  });

  it('finds no remotes in a repository that has none', async () =>
  {
    expect(await getRemoteNames(repo)).toEqual([]);
  });

  it('runs the argv it advertises', async () =>
  {
    // The §8 guarantee: what buildLogArgs returns is what git accepts. If these
    // drift, the preview lies.
    const args = buildLogArgs({ limit: 1, scope: 'all', order: 'topo' });
    expect(() => execFileSync('git', args, { cwd: repo })).not.toThrow();
  });

  it('filters by message without shell quoting', async () =>
  {
    const commits = await readLog(repo, { scope: 'all', messageFilter: 'commas and "quotes"' });
    expect(commits).toHaveLength(1);
  });

  it('reports no commits for a filter that matches nothing', async () =>
  {
    expect(await readLog(repo, { scope: 'all', messageFilter: 'zzz-no-match' })).toEqual([]);
  });

  describe('the branch scope', () =>
  {
    it('shows commits on branches the current one does not contain', async () =>
    {
      // The bug this covers: the grid defaulted to walking HEAD alone, so every
      // unmerged branch and every tag outside its history was missing, which also left
      // the left panel's nodes pointing at commits that were not on screen.
      git('checkout', '-q', 'main');
      git('checkout', '-q', '-b', 'unmerged');
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'only on unmerged'], {
        cwd: repo
      });
      git('checkout', '-q', 'main');

      const all = await readLog(repo, { scope: 'all' });
      const current = await readLog(repo, { scope: 'current' });

      expect(all.map((c) => c.subject)).toContain('only on unmerged');
      expect(current.map((c) => c.subject)).not.toContain('only on unmerged');

      git('branch', '-D', 'unmerged');
    });

    it('leaves the stash out of the history, which `--all` would not', async () =>
    {
      // `git log --all` walks every ref under refs/, refs/stash included, so the
      // stash's own commits appear as ordinary history. This is why the `all` scope
      // names the three ref namespaces instead.
      await writeFile(join(repo, 'stashed.txt'), 'work in progress\n');
      git('add', 'stashed.txt');
      git('stash', 'push', '-m', 'wip');

      // `-m` gives the stash entry's subject as "On <branch>: <message>", no "WIP on"
      // prefix, which only appears on the message git generates itself.
      const commits = await readLog(repo, { scope: 'all' });
      expect(commits.map((c) => c.subject)).not.toContain('On main: wip');

      git('stash', 'drop');
    });

    it('brings the stash back in when includeStashes is on, on any scope', async () =>
    {
      // The glob trick this proves against real git: `refs/stas[h]` has to resolve
      // to exactly `refs/stash`, not to nothing (the implicit `/*` a literal pattern
      // gets) and not to an error (a bare `refs/stash` when there is none).
      //
      // Both halves check the branch's own history is still there, and that is not
      // padding: a glob counts as naming the revisions to walk even when it matches
      // nothing, so the current-branch scope stopped saying HEAD and returned an empty
      // list. "The stash is not in it" is true of an empty list too.
      const withoutStash = await readLog(repo, { scope: 'current', includeStashes: true });
      expect(withoutStash.map((c) => c.subject)).toContain('first commit');
      expect(withoutStash.map((c) => c.subject)).not.toContain('On main: wip');

      await writeFile(join(repo, 'stashed.txt'), 'work in progress\n');
      git('add', 'stashed.txt');
      git('stash', 'push', '-m', 'wip');

      const commits = await readLog(repo, { scope: 'current', includeStashes: true });
      expect(commits.map((c) => c.subject)).toContain('On main: wip');
      expect(commits.map((c) => c.subject)).toContain('first commit');

      git('stash', 'drop');
    });

    it('shows only branches matching a wildcard filter', async () =>
    {
      git('checkout', '-q', 'main');
      git('checkout', '-q', '-b', 'feature/x');
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'on feature/x'], { cwd: repo });
      git('checkout', '-q', '-b', 'release/1.0', 'main');
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'on release/1.0'], {
        cwd: repo
      });
      git('checkout', '-q', 'main');

      const commits = await readLog(repo, { scope: 'filtered', refs: ['feature/*'] });
      const subjects = commits.map((c) => c.subject);
      expect(subjects).toContain('on feature/x');
      expect(subjects).not.toContain('on release/1.0');

      git('branch', '-D', 'feature/x', 'release/1.0');
    });
  });

  describe('per-commit details', () =>
  {
    it('reports a commit with no note as having none, rather than as a failure', async () =>
    {
      const [commit] = await readLog(repo, { limit: 1, scope: 'all' });
      const details = await getCommitDetails(repo, commit!.sha);

      // Almost every commit anyone opens has no note; that has to be the quiet case.
      expect(details.sha).toBe(commit!.sha);
      expect(details.note).toBe('');
    });

    it('reads an attached git note, including its line breaks', async () =>
    {
      const [commit] = await readLog(repo, { limit: 1, scope: 'all' });
      git('notes', 'add', '-m', 'reviewed by Grace\nsecond line', commit!.sha);

      const details = await getCommitDetails(repo, commit!.sha);
      expect(details.note).toBe('reviewed by Grace\nsecond line');

      git('notes', 'remove', commit!.sha);
    });

    it('does not reject on a SHA that does not exist', async () =>
    {
      // Selection can outlive a rewritten history, and a details pane throwing
      // because a commit vanished would be worse than one saying nothing.
      const details = await getCommitDetails(repo, '0'.repeat(40));

      expect(details.sha).toBe('0'.repeat(40));
      expect(details.note).toBe('');
    });
  });
});

/**
 * A repository with nothing committed yet.
 *
 * Its own repository, since every other test here needs a history: the point is that
 * there is none, and the scope has to be an empty grid rather than an error.
 */
describe('an unborn branch against real git', () =>
{
  let unborn: string;

  beforeAll(async () =>
  {
    unborn = await realpath(await mkdtemp(join(tmpdir(), 'gitext-unborn-')));
    execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: unborn });
  });

  afterAll(async () =>
  {
    await rm(unborn, { recursive: true, force: true });
  });

  it('reads as an empty history rather than an error, in every scope', async () =>
  {
    // Naming HEAD is what makes the current-branch scope work at all, and `git log HEAD`
    // with no commits is fatal where a bare `git log` is merely empty: `--ignore-missing`
    // is what buys that back.
    await expect(readLog(unborn, { scope: 'current', includeStashes: true })).resolves.toEqual([]);
    await expect(readLog(unborn, { scope: 'all', includeStashes: true })).resolves.toEqual([]);
  });
});
