/**
 * Turning a blamed file into the rows drawn beside it.
 *
 * One row per line, in the file's own order, so row `n` sits against line `n` and the
 * two scroll together. A row repeating the commit above it is marked rather than
 * dropped: a position in this list is a line, so leaving one out would slide every
 * row below it up a line.
 */

import type { BlameCommitInfo, BlameFile } from '@shared/types.js';

/** git's sentinel for a line that is not committed yet: forty zeroes. */
export const UNCOMMITTED_SHA = '0'.repeat(40);

export interface BlameGutterRow {
  sha: string;
  /** Same commit as the line above: drawn blank, so a run of one commit reads as a block. */
  repeat: boolean;
  /** The commit behind the line, when blame named one. */
  commit: BlameCommitInfo | null;
}

export function blameGutterRows(file: BlameFile | null): BlameGutterRow[]
{
  if (!file)
  {
    return [];
  }
  let lastSha: string | null = null;
  return file.lines.map((line) =>
  {
    const repeat = line.sha === lastSha;
    lastSha = line.sha;
    return { sha: line.sha, repeat, commit: file.commits[line.sha] ?? null };
  });
}

/** The blamed file as text, for the editor the gutter sits against. */
export function blameText(file: BlameFile): string
{
  return file.lines.map((line) => line.text).join('\n');
}

/** The stretch of gutter that is worth drawing, and where to put it. */
export interface GutterWindow {
  /** Index of the first row drawn. */
  first: number;
  /** How many rows to draw from there. */
  count: number;
  /** Where that first row sits in the scrolled content, in px. */
  offset: number;
  /** The full column's height, so the scrollbar is the file's, not the window's. */
  height: number;
}

/**
 * Which rows to draw for a gutter scrolled to `scrollTop`.
 *
 * A row per line of a real file is tens of thousands of elements, all but a screenful of
 * them off-screen: the column is drawn as the rows in view inside a box the full height,
 * so scrolling stays the file's own and the DOM stays the size of the viewport.
 *
 * `overscan` rows are kept either side of what is strictly visible, so a scroll that
 * lands between two frames does not show a blank strip before the next one.
 */
export function gutterWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  paddingTop: number,
  overscan: number
): GutterWindow
{
  const height = paddingTop + rowCount * rowHeight;
  // The editor's own top padding scrolls with its text, so the rows start that far down
  // and a scroll position has to be read from where they start, not from the box's top.
  const scrolled = Math.max(0, scrollTop - paddingTop);
  const first = Math.max(0, Math.floor(scrolled / rowHeight) - overscan);
  const last = Math.min(
    rowCount,
    Math.ceil((scrolled + Math.max(0, viewportHeight)) / rowHeight) + overscan
  );
  return { first, count: Math.max(0, last - first), offset: paddingTop + first * rowHeight, height };
}
