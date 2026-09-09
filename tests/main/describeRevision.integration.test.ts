/**
 * `describeRevision` against a real git.
 *
 * The compare dialog's slot cards are the caller: each end of a comparison is whatever
 * the user named, a branch, a tag, a SHA prefix, `HEAD~1`, and the card has to say
 * which commit that currently *is*. Nothing here is mocked; the point is what git
 * actually resolves, including the two cases that must answer `null` rather than throw.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeRevision } from '@main/git/commitDetails.js';
import { runGit } from '@main/git/runner.js';

const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

let root: string;
let repo: string;
let firstSha: string;
let headSha: string;

beforeAll(async () =>
{
  // git canonicalizes paths; on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-describe-')));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', repo]);

  await runGit(repo, [...IDENTITY, 'commit', '--allow-empty', '-m', 'first subject']);
  firstSha = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();

  // An annotated tag, so the `^{commit}` peel has something to peel.
  await runGit(repo, [...IDENTITY, 'tag', '-a', 'v1.0', '-m', 'release one']);

  await runGit(repo, [...IDENTITY, 'commit', '--allow-empty', '-m', 'second subject']);
  headSha = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();

  await runGit(repo, ['branch', 'side', firstSha]);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('describeRevision', () =>
{
  it('describes HEAD', async () =>
  {
    const found = await describeRevision(repo, 'HEAD');
    expect(found).toEqual({
      sha: headSha,
      subject: 'second subject',
      authorName: 'Test',
      authorDate: expect.any(Number)
    });
    expect(found!.authorDate).toBeGreaterThan(0);
  });

  it('resolves a branch to the commit it currently points at', async () =>
  {
    // The whole reason the card shows a resolved SHA beside the name: a branch is a
    // moving target, and "compared against side" is only reproducible with the SHA.
    const found = await describeRevision(repo, 'side');
    expect(found?.sha).toBe(firstSha);
    expect(found?.subject).toBe('first subject');
  });

  it('peels an annotated tag to its commit', async () =>
  {
    // Without `^{commit}` this resolves to the *tag object*, whose SHA is not a commit
    // and would produce a diff argument git rejects.
    const found = await describeRevision(repo, 'v1.0');
    expect(found?.sha).toBe(firstSha);
    expect(found?.subject).toBe('first subject');
  });

  it('takes a SHA prefix, which is what gets pasted out of a bug report', async () =>
  {
    const found = await describeRevision(repo, headSha.slice(0, 8));
    expect(found?.sha).toBe(headSha);
  });

  it('takes revision syntax', async () =>
  {
    const found = await describeRevision(repo, 'HEAD~1');
    expect(found?.sha).toBe(firstSha);
  });

  it('answers null for a revision that does not resolve, rather than throwing', async () =>
  {
    // The picker asks this on every keystroke, so a half-typed SHA is not an error:
    // it is simply not a revision yet.
    expect(await describeRevision(repo, 'no-such-branch')).toBeNull();
    expect(await describeRevision(repo, 'deadbee')).toBeNull();
  });

  it('answers null for an empty revision without running git', async () =>
  {
    expect(await describeRevision(repo, '')).toBeNull();
    expect(await describeRevision(repo, '   ')).toBeNull();
  });

  it('answers null for a path that is not a commit', async () =>
  {
    // `rev-parse` would happily hand back a blob here; `log` wants a commit, which is
    // why this reads through `log` rather than resolving and then describing.
    await writeFile(join(repo, 'file.txt'), 'content\n');
    await runGit(repo, ['add', 'file.txt']);
    await runGit(repo, [...IDENTITY, 'commit', '-m', 'add file']);

    const blob = (await runGit(repo, ['rev-parse', 'HEAD:file.txt'])).trim();
    expect(await describeRevision(repo, blob)).toBeNull();
  });

  it('keeps a subject that contains a NUL-adjacent oddity intact', async () =>
  {
    // The format is NUL-separated, so a subject with newlines and percent signs in it
    // is the case that would break a naive split.
    await runGit(repo, [...IDENTITY, 'commit', '--allow-empty', '-m', 'fix: 100% of %s cases']);
    const found = await describeRevision(repo, 'HEAD');
    expect(found?.subject).toBe('fix: 100% of %s cases');
  });
});
