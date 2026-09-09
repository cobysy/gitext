/**
 * `readLog({ follow: true })` and `readBlame` against real git.
 *
 * Builds a small history on purpose: two authors, a rename, and an edit after the
 * rename: the shape `--follow` and blame both have to get right, or the file history
 * dialog silently loses history across a rename or misattributes a line.
 */

import { mkdtemp, rm, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLogArgs, readLog } from '@main/git/log.js';
import { readBlame } from '@main/git/blame.js';
import { runGit } from '@main/git/runner.js';

let root = '';
let repo = '';

const ADA = ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', '-c', 'commit.gpgsign=false'];
const GRACE = [
  '-c',
  'user.name=Grace',
  '-c',
  'user.email=grace@example.com',
  '-c',
  'commit.gpgsign=false'
];

async function commit(identity: string[], message: string): Promise<void>
{
  await runGit(repo, [...identity, 'commit', '-m', message]);
}

beforeAll(async () =>
{
  // git reports canonical paths; resolve symlinks up front: see git.integration.test.ts.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-blame-test-')));
  repo = join(root, 'repo');
  await mkdir(repo);
  await runGit(repo, ['init', '-b', 'main']);

  await writeFile(join(repo, 'old-name.txt'), 'line one\nline two\n');
  await runGit(repo, ['add', 'old-name.txt']);
  await commit(ADA, 'Ada: add the file');

  await runGit(repo, ['mv', 'old-name.txt', 'new-name.txt']);
  await commit(GRACE, 'Grace: rename it');

  await writeFile(join(repo, 'new-name.txt'), 'line one\nline two\nline three\n');
  await runGit(repo, ['add', 'new-name.txt']);
  await commit(GRACE, 'Grace: add a line after the rename');
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('readLog with follow', () =>
{
  it('crosses the rename: commits at the old name are still in the history', async () =>
  {
    const commits = await readLog(repo, { paths: ['new-name.txt'], follow: true });
    const subjects = commits.map((c) => c.subject);
    expect(subjects).toContain('Ada: add the file');
    expect(subjects).toContain('Grace: rename it');
    expect(subjects).toContain('Grace: add a line after the rename');
  });

  it('finds nothing without --follow once the file has been renamed away from', async () =>
  {
    // The whole point of the flag: plain `-- old-name.txt` stops at the rename.
    const commits = await readLog(repo, { paths: ['old-name.txt'] });
    const subjects = commits.map((c) => c.subject);
    expect(subjects).not.toContain('Grace: add a line after the rename');
  });
});

describe('readBlame', () =>
{
  it('attributes each line to the commit that introduced it, across the rename', async () =>
  {
    const blame = await readBlame(repo, null, 'new-name.txt');
    expect(blame.lines).toHaveLength(3);

    const [line1, line2, line3] = blame.lines;
    expect(blame.commits[line1!.sha]?.author).toBe('Ada');
    expect(blame.commits[line2!.sha]?.author).toBe('Ada');
    expect(blame.commits[line3!.sha]?.author).toBe('Grace');
  });

  it('blames the working tree, not HEAD, when the revision is null', async () =>
  {
    await writeFile(join(repo, 'new-name.txt'), 'line one\nline two\nline three\nline four\n');
    try
    {
      const blame = await readBlame(repo, null, 'new-name.txt');
      const uncommitted = blame.lines.find((l) => l.text === 'line four');
      expect(uncommitted?.sha).toBe('0'.repeat(40));
      expect(blame.commits[uncommitted!.sha]?.author).toBe('Not Committed Yet');

      // And HEAD alone knows nothing about it.
      const atHead = await readBlame(repo, { kind: 'commit', sha: 'HEAD' }, 'new-name.txt');
      expect(atHead.lines).toHaveLength(3);
    }
    finally
    {
      // Leave the working tree clean for any test that runs after this one.
      await runGit(repo, ['checkout', '--', 'new-name.txt']);
    }
  });
});

describe('buildLogArgs assertion', () =>
{
  it('throws rather than silently walking the wrong question with two paths', () =>
  {
    expect(() => buildLogArgs({ follow: true, paths: ['a.txt', 'b.txt'] })).toThrow();
  });
});
