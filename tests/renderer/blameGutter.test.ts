/**
 * The rows drawn beside a blamed file.
 *
 * A row is a line, so the count and the order are the whole contract: a gutter one row
 * short of the file puts every name below the gap against the wrong line, and the
 * further you scroll the worse it reads.
 */

import { describe, expect, it } from 'vitest';
import type { BlameCommitInfo, BlameFile } from '@shared/types.js';
import {
  blameGutterRows,
  blameText,
  gutterWindow,
  UNCOMMITTED_SHA
} from '@renderer/model/blameGutter.js';

function commit(sha: string, author: string): BlameCommitInfo
{
  return {
    sha,
    author,
    authorMail: `<${author}@example.com>`,
    authorTime: 1700000000,
    authorTz: '+0000',
    committer: author,
    committerMail: `<${author}@example.com>`,
    committerTime: 1700000000,
    committerTz: '+0000',
    summary: 'a change',
    filename: 'a.txt'
  };
}

function blamed(shas: string[]): BlameFile
{
  const commits: Record<string, BlameCommitInfo> = {};
  for (const sha of new Set(shas))
  {
    commits[sha] = commit(sha, `author-${sha}`);
  }
  return {
    path: 'a.txt',
    commits,
    lines: shas.map((sha, i) => ({ sha, origLine: i + 1, finalLine: i + 1, text: `line ${i + 1}` })),
    binary: false
  };
}

describe('blame gutter rows', () =>
{
  it('draws one row per line, in the file\'s order', () =>
  {
    const rows = blameGutterRows(blamed(['a', 'b', 'c']));
    expect(rows.map((row) => row.sha)).toEqual(['a', 'b', 'c']);
  });

  it('marks a line whose commit is the one above it, and keeps its row', () =>
  {
    const rows = blameGutterRows(blamed(['a', 'a', 'b', 'a']));
    expect(rows.map((row) => row.repeat)).toEqual([false, true, false, false]);
  });

  it('carries the commit behind each line, and null when blame named none', () =>
  {
    const file = blamed(['a', 'b']);
    delete file.commits['b'];
    const rows = blameGutterRows(file);
    expect(rows[0]?.commit?.author).toBe('author-a');
    expect(rows[1]?.commit).toBeNull();
  });

  it('has nothing to draw with no file', () =>
  {
    expect(blameGutterRows(null)).toEqual([]);
  });

  it('knows git\'s sentinel for a line that is not committed yet', () =>
  {
    expect(UNCOMMITTED_SHA).toHaveLength(40);
    const rows = blameGutterRows(blamed([UNCOMMITTED_SHA]));
    expect(rows[0]?.sha).toBe(UNCOMMITTED_SHA);
  });

  it('joins the lines back into the text the editor shows', () =>
  {
    expect(blameText(blamed(['a', 'b']))).toBe('line 1\nline 2');
  });
});

/**
 * A column of 18px rows under a 4px gap, scrolled with the editor beside it: the same
 * numbers `useReadOnlyEditor` gives Monaco, which is why they are passed in rather than
 * written here twice.
 */
describe('the stretch of gutter worth drawing', () =>
{
  const ROW = 18;
  const PAD = 4;

  it('reserves the whole file\'s height, so the scrollbar is the file\'s', () =>
  {
    expect(gutterWindow(1000, 0, 360, ROW, PAD, 0).height).toBe(PAD + 1000 * ROW);
  });

  it('draws a viewport\'s worth, not a file\'s', () =>
  {
    const drawn = gutterWindow(20000, 0, 360, ROW, PAD, 0);
    expect(drawn.first).toBe(0);
    expect(drawn.count).toBe(20);
  });

  it('starts at the row the scroll position is on, under the editor\'s top gap', () =>
  {
    // Scrolled by 100 rows: the gap is above the rows, so it comes off the scroll first.
    const drawn = gutterWindow(20000, PAD + 100 * ROW, 360, ROW, PAD, 0);
    expect(drawn.first).toBe(100);
    expect(drawn.offset).toBe(PAD + 100 * ROW);
  });

  it('keeps overscan rows either side, without running past the file', () =>
  {
    const middle = gutterWindow(20000, PAD + 100 * ROW, 360, ROW, PAD, 12);
    expect(middle.first).toBe(88);
    expect(middle.count).toBe(20 + 24);

    // At the top there is nothing above to keep, and the offset stays the gap itself.
    const top = gutterWindow(20000, 0, 360, ROW, PAD, 12);
    expect(top.first).toBe(0);
    expect(top.offset).toBe(PAD);

    // At the end it stops at the last row rather than asking for rows that aren't there.
    const end = gutterWindow(100, PAD + 100 * ROW, 360, ROW, PAD, 12);
    expect(end.first + end.count).toBe(100);
  });

  it('draws nothing for a file with no lines, and never a negative count', () =>
  {
    expect(gutterWindow(0, 0, 360, ROW, PAD, 12)).toEqual({
      first: 0,
      count: 0,
      offset: PAD,
      height: PAD
    });
  });

  it('survives a viewport it has not measured yet', () =>
  {
    // The observer has not reported, so the height is 0: the window is empty, not upside down.
    expect(gutterWindow(500, 0, 0, ROW, PAD, 0).count).toBe(0);
  });
});
