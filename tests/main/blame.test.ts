import { describe, expect, it } from 'vitest';
import { parseBlame } from '@main/git/parse.js';
import { buildBlameArgs } from '@main/git/blame.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const UNCOMMITTED = '0'.repeat(40);

describe('parseBlame', () =>
{
  it('reads a single commit blaming every line', () =>
  {
    const text = [
      `${SHA_A} 1 1 2`,
      'author Ada Lovelace',
      'author-mail <ada@example.com>',
      'author-time 1700000000',
      'author-tz +0200',
      'committer Ada Lovelace',
      'committer-mail <ada@example.com>',
      'committer-time 1700000000',
      'committer-tz +0200',
      'summary Initial commit',
      'filename a.txt',
      '\tone',
      `${SHA_A} 2 2`,
      '\ttwo',
      ''
    ].join('\n');

    const result = parseBlame(text, 'a.txt');

    expect(result.lines).toEqual([
      { sha: SHA_A, origLine: 1, finalLine: 1, text: 'one' },
      { sha: SHA_A, origLine: 2, finalLine: 2, text: 'two' }
    ]);
    expect(Object.keys(result.commits)).toEqual([SHA_A]);
    expect(result.commits[SHA_A]).toMatchObject({
      author: 'Ada Lovelace',
      authorMail: 'ada@example.com',
      authorTime: 1700000000,
      authorTz: '+0200',
      summary: 'Initial commit',
      filename: 'a.txt'
    });
  });

  it('prints a commit’s metadata only once, and reuses it on later chunks', () =>
  {
    const text = [
      `${SHA_A} 1 1 1`,
      'author Ada',
      'author-mail <ada@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'committer Ada',
      'committer-mail <ada@example.com>',
      'committer-time 1700000000',
      'committer-tz +0000',
      'summary First',
      'filename a.txt',
      '\tone',
      `${SHA_B} 1 2 1`,
      'author Grace',
      'author-mail <grace@example.com>',
      'author-time 1700000100',
      'author-tz +0000',
      'committer Grace',
      'committer-mail <grace@example.com>',
      'committer-time 1700000100',
      'committer-tz +0000',
      'summary Second',
      'filename a.txt',
      '\ttwo',
      // The first commit again: header only, no metadata lines this time.
      `${SHA_A} 2 3`,
      '\tthree',
      ''
    ].join('\n');

    const result = parseBlame(text, 'a.txt');

    expect(result.lines.map((l) => l.sha)).toEqual([SHA_A, SHA_B, SHA_A]);
    expect(result.lines[2]).toEqual({ sha: SHA_A, origLine: 2, finalLine: 3, text: 'three' });
    // Reused from the cache, not blank.
    expect(result.commits[SHA_A]?.author).toBe('Ada');
    expect(result.commits[SHA_B]?.author).toBe('Grace');
  });

  it('reads a rename’s previous path', () =>
  {
    const text = [
      `${SHA_A} 1 1 1`,
      'author Ada',
      'author-mail <ada@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'committer Ada',
      'committer-mail <ada@example.com>',
      'committer-time 1700000000',
      'committer-tz +0000',
      'summary Rename',
      'previous ' + SHA_B + ' old-name.txt',
      'filename new-name.txt',
      '\tsome text',
      ''
    ].join('\n');

    const result = parseBlame(text, 'new-name.txt');
    expect(result.commits[SHA_A]).toMatchObject({
      previousSha: SHA_B,
      previousPath: 'old-name.txt',
      filename: 'new-name.txt'
    });
  });

  it('does not choke on a boundary commit', () =>
  {
    const text = [
      `${SHA_A} 1 1 1`,
      'author Root',
      'author-mail <root@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'committer Root',
      'committer-mail <root@example.com>',
      'committer-time 1700000000',
      'committer-tz +0000',
      'summary Root commit',
      'boundary',
      'filename a.txt',
      '\tone',
      ''
    ].join('\n');

    const result = parseBlame(text, 'a.txt');
    expect(result.commits[SHA_A]).toMatchObject({ boundary: true, author: 'Root' });
    expect(result.lines).toEqual([{ sha: SHA_A, origLine: 1, finalLine: 1, text: 'one' }]);
  });

  it('carries git’s own sentinel for an uncommitted line untouched', () =>
  {
    const text = [
      `${UNCOMMITTED} 1 1 1`,
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 1700000200',
      'author-tz +0000',
      'committer Not Committed Yet',
      'committer-mail <not.committed.yet>',
      'committer-time 1700000200',
      'committer-tz +0000',
      'summary Uncommitted changes',
      'filename a.txt',
      '\tedited line',
      ''
    ].join('\n');

    const result = parseBlame(text, 'a.txt');
    expect(result.lines[0]?.sha).toBe(UNCOMMITTED);
    expect(result.commits[UNCOMMITTED]?.author).toBe('Not Committed Yet');
  });

  it('preserves a tab-indented line of actual code, not just the leading tab', () =>
  {
    const text = [
      `${SHA_A} 1 1 1`,
      'author Ada',
      'author-mail <ada@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'committer Ada',
      'committer-mail <ada@example.com>',
      'committer-time 1700000000',
      'committer-tz +0000',
      'summary Indented',
      'filename a.ts',
      '\t\tif (x) return;',
      ''
    ].join('\n');

    const result = parseBlame(text, 'a.ts');
    expect(result.lines[0]?.text).toBe('\tif (x) return;');
  });

  it('returns nothing for empty output', () =>
  {
    expect(parseBlame('', 'a.txt')).toEqual({ path: 'a.txt', lines: [], commits: {} });
  });
});

describe('buildBlameArgs', () =>
{
  it('blames the working tree with no revision argument when given null', () =>
  {
    const args = buildBlameArgs(null, 'src/main.ts');
    expect(args).toEqual(['blame', '--porcelain', '-w', '-l', '--', 'src/main.ts']);
  });

  it('blames the working tree for the index and working-tree endpoints too', () =>
  {
    expect(buildBlameArgs({ kind: 'index' }, 'a.txt')).toEqual(buildBlameArgs(null, 'a.txt'));
    expect(buildBlameArgs({ kind: 'workingTree' }, 'a.txt')).toEqual(buildBlameArgs(null, 'a.txt'));
  });

  it('names the revision when given a commit', () =>
  {
    const args = buildBlameArgs({ kind: 'commit', sha: 'deadbeef' }, 'src/main.ts');
    expect(args).toEqual(['blame', '--porcelain', '-w', '-l', 'deadbeef', '--', 'src/main.ts']);
  });
});
