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
  /**
   * Alternating between neighbouring runs, drawn as a shade.
   *
   * A run is named on its first row and blank below it, so a long one is a column of
   * empty rows: without a shade behind it there is nothing on the line that says which
   * name above it still applies, or where the next commit takes over.
   */
  band: boolean;
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
  let band = false;
  return file.lines.map((line) =>
  {
    const repeat = line.sha === lastSha;
    lastSha = line.sha;
    if (!repeat)
    {
      band = !band;
    }
    return { sha: line.sha, repeat, band, commit: file.commits[line.sha] ?? null };
  });
}

/** The blamed file as text, for the editor the gutter sits against. */
export function blameText(file: BlameFile): string
{
  return file.lines.map((line) => line.text).join('\n');
}

/** An inclusive stretch of lines, counted from zero like the gutter's own rows. */
export interface LineRange {
  first: number;
  last: number;
}

/**
 * Every stretch of the file one commit wrote.
 *
 * The gutter names a commit on the first row of each run, and a commit usually wrote
 * several runs: pointing at one of them has to mark them all, or the answer stops at
 * whichever run the pointer happened to be over.
 */
export function linesOfCommit(rows: BlameGutterRow[], sha: string): LineRange[]
{
  const ranges: LineRange[] = [];
  let open: LineRange | null = null;
  rows.forEach((row, line) =>
  {
    if (row.sha !== sha)
    {
      open = null;
      return;
    }
    if (open && open.last === line - 1)
    {
      open.last = line;
      return;
    }
    open = { first: line, last: line };
    ranges.push(open);
  });
  return ranges;
}

/** Where a drawn row goes: the line it names, and its top in the scrolled content. */
export interface GutterPlacement {
  /** Index into the gutter's rows, which is the file's own line order. */
  line: number;
  /** The row's top, in px from the top of the scrolled content. */
  top: number;
}

/**
 * How the editor beside the gutter has laid the file out.
 *
 * The gutter cannot work its own rows out from a line height once the editor can fold:
 * a folded run's lines are still lines of the file, so counting them puts every row
 * below the fold that far down the column while the text they name has moved up. The
 * editor is the only thing that knows where a line ended up, so it is asked.
 *
 * Lines are indices into the file, counting from zero, like the gutter's own rows:
 * whoever adapts an editor to this is where its own numbering stops.
 */
export interface EditorLineLayout {
  /** The lines the viewport is showing, as inclusive ranges, folds left out. */
  visible: LineRange[];
  /** Where a line's top sits in the scrolled content, in px. */
  topOf: (line: number) => number;
}

/**
 * The rows to draw against an editor that has laid the file out.
 *
 * A line hidden inside a fold is drawn where the line that hides it is, so the rows walk
 * the range once and keep only those that moved on: that drops a fold's insides without
 * having to be told where the folds are, and keeps the row of whatever follows one.
 */
export function laidOutPlacements(
  rowCount: number,
  lines: EditorLineLayout,
  overscan: number
): GutterPlacement[]
{
  const first = lines.visible[0];
  const last = lines.visible[lines.visible.length - 1];
  if (!first || !last)
  {
    return [];
  }
  const from = Math.max(0, first.first - overscan);
  const to = Math.min(rowCount - 1, last.last + overscan);
  const placements: GutterPlacement[] = [];
  let previousTop = -1;
  for (let line = from; line <= to; line += 1)
  {
    const top = lines.topOf(line);
    if (top > previousTop)
    {
      previousTop = top;
      placements.push({ line, top });
    }
  }
  return placements;
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

/**
 * A row per line at an even step: the rows to draw before the editor has said anything.
 *
 * It is right until something folds, and an editor with nothing folded reports exactly
 * these positions: so the two ways of placing a row agree, and the gutter is drawn from
 * the first frame rather than staying blank until the editor's first event.
 */
export function evenPlacements(drawn: GutterWindow, rowHeight: number): GutterPlacement[]
{
  return Array.from({ length: drawn.count }, (_unused, i) => ({
    line: drawn.first + i,
    top: drawn.offset + i * rowHeight
  }));
}
