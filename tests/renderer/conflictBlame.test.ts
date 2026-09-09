import { describe, expect, it } from 'vitest';
import type { BlameCommitInfo, BlameFile } from '@shared/types.js';
import { commitForLines, findLineRange, latestCommit } from '@renderer/model/conflictBlame.js';

function commit(sha: string, authorTime: number, summary = ''): BlameCommitInfo
{
  return {
    sha,
    author: `author-${sha}`,
    authorMail: '',
    authorTime,
    authorTz: '+0000',
    committer: '',
    committerMail: '',
    committerTime: authorTime,
    committerTz: '+0000',
    summary,
    filename: 'file.txt'
  };
}

function blame(shas: readonly string[], commits: Record<string, BlameCommitInfo>): BlameFile
{
  return {
    path: 'file.txt',
    lines: shas.map((sha, index) => ({ sha, origLine: index + 1, finalLine: index + 1, text: '' })),
    commits
  };
}

describe('findLineRange', () =>
{
  it('finds a run of lines', () =>
  {
    const haystack = ['a', 'b', 'c', 'd', 'e'];
    expect(findLineRange(haystack, ['c', 'd'], 0)).toEqual({ start: 2, end: 3 });
  });

  it('respects the search floor, for the second of two identical runs', () =>
  {
    const haystack = ['x', 'y', 'x', 'y'];
    expect(findLineRange(haystack, ['x', 'y'], 0)).toEqual({ start: 0, end: 1 });
    expect(findLineRange(haystack, ['x', 'y'], 1)).toEqual({ start: 2, end: 3 });
  });

  it('returns null when the run is not there', () =>
  {
    expect(findLineRange(['a', 'b', 'c'], ['z'], 0)).toBeNull();
  });

  it('returns null for an empty needle', () =>
  {
    expect(findLineRange(['a', 'b'], [], 0)).toBeNull();
  });

  it('returns null when the needle is longer than what remains after `from`', () =>
  {
    expect(findLineRange(['a', 'b', 'c'], ['b', 'c', 'd'], 0)).toBeNull();
  });
});

describe('commitForLines', () =>
{
  it('picks the latest commit among the lines in range', () =>
  {
    const older = commit('older', 1000);
    const newer = commit('newer', 2000);
    const file = blame(['older', 'newer', 'older'], { older, newer });
    expect(commitForLines(file, 1, 3)).toBe(newer);
  });

  it('ignores lines outside the range', () =>
  {
    const inRange = commit('in', 1000);
    const outOfRange = commit('out', 9999);
    const file = blame(['out', 'in', 'out'], { in: inRange, out: outOfRange });
    expect(commitForLines(file, 2, 2)).toBe(inRange);
  });

  it('returns null when nothing blamed falls in range', () =>
  {
    const file = blame(['a'], { a: commit('a', 1000) });
    expect(commitForLines(file, 5, 10)).toBeNull();
  });
});

describe('latestCommit', () =>
{
  it('is the latest commit across the whole file', () =>
  {
    const older = commit('older', 1000);
    const newer = commit('newer', 2000);
    const file = blame(['older', 'newer'], { older, newer });
    expect(latestCommit(file)).toBe(newer);
  });

  it('is null for a side that was not blamed', () =>
  {
    expect(latestCommit(null)).toBeNull();
  });
});
