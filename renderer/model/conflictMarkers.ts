/**
 * Conflict markers, as a structure rather than text to eyeball. Pure and DOM-free:
 * `ConflictFileDialog.vue` re-parses the editor's current text after every change
 * rather than tracking line-number deltas by hand. Git's default markers carry two
 * sides; `merge.conflictStyle=diff3` adds a third, `|||||||`, parsed out where present and ignored otherwise.
 */

const MARKER_START = '<<<<<<<';
const MARKER_BASE = '|||||||';
const MARKER_MID = '=======';
const MARKER_END = '>>>>>>>';

export interface ConflictBlock {
  /** 1-based, Monaco's own line numbering: the line the `<<<<<<<` marker is on. */
  startLine: number;
  /** The line the matching `>>>>>>>` marker is on. */
  endLine: number;
  /** The line the `=======` marker is on: where ours stops and theirs starts. */
  midLine: number;
  /** The line the `|||||||` marker is on for diff3 style, else null: ours ends the line before it rather than before `=======`. */
  baseMarkerLine: number | null;
  oursLabel: string;
  theirsLabel: string;
  oursLines: string[];
  theirsLines: string[];
  /**
   * The common ancestor for this block, when the file carries one. Only
   * `diff3`/`zdiff3` style writes it; git's default style leaves it null, and
   * `conflictAutoMerge.ts` works the region out from the base blob instead.
   */
  baseLines: string[] | null;
}

/**
 * The first line at or after `from` that is exactly `marker`, or -1. A `<<<<<<<` before
 * it ends the search unfound: without this an unterminated block reaches into the next one, and both get read and resolved as a single block.
 */
function findLine(lines: readonly string[], from: number, marker: string): number
{
  for (let i = from; i < lines.length; i += 1)
  {
    if (lines[i] === marker)
    {
      return i;
    }
    if (lines[i]!.startsWith(MARKER_START))
    {
      return -1;
    }
  }
  return -1;
}

/**
 * Every conflict block in `text`, in order. A malformed block, with no matching
 * `=======`/`>>>>>>>`, is skipped rather than thrown on: a half-written conflict is exactly the state a hand-edit passes through.
 */
export function parseConflictBlocks(text: string): ConflictBlock[]
{
  const lines = text.split('\n');
  const blocks: ConflictBlock[] = [];
  let i = 0;

  while (i < lines.length)
  {
    const line = lines[i]!;
    if (!line.startsWith(MARKER_START))
    {
      i += 1;
      continue;
    }

    // Either marker can close the "ours" side: `|||||||` under diff3 style, `=======`
    // under the default one. A second `<<<<<<<` ends the scan instead: see `findLine`.
    let splitAt = i + 1;
    while (
      splitAt < lines.length &&
      !lines[splitAt]!.startsWith(MARKER_BASE) &&
      lines[splitAt] !== MARKER_MID &&
      !lines[splitAt]!.startsWith(MARKER_START)
    )
    {
      splitAt += 1;
    }
    if (splitAt >= lines.length || lines[splitAt]!.startsWith(MARKER_START))
    {
      i += 1;
      continue;
    }

    let mid: number;
    let baseLines: string[] | null = null;
    if (lines[splitAt]!.startsWith(MARKER_BASE))
    {
      mid = findLine(lines, splitAt + 1, MARKER_MID);
      if (mid !== -1)
      {
        baseLines = lines.slice(splitAt + 1, mid);
      }
    }
    else
    {
      mid = splitAt;
    }
    if (mid === -1)
    {
      i += 1;
      continue;
    }

    let end = -1;
    for (let j = mid + 1; j < lines.length; j += 1)
    {
      if (lines[j]!.startsWith(MARKER_END))
      {
        end = j;
        break;
      }
      // Same rule as `findLine`: the next block's opener is not this block's business.
      if (lines[j]!.startsWith(MARKER_START))
      {
        break;
      }
    }
    if (end === -1)
    {
      i += 1;
      continue;
    }

    let baseMarkerLine: number | null;
    if (baseLines === null)
    {
      baseMarkerLine = null;
    }
    else
    {
      baseMarkerLine = splitAt + 1;
    }

    blocks.push({
      startLine: i + 1,
      endLine: end + 1,
      midLine: mid + 1,
      baseMarkerLine,
      oursLabel: line.slice(MARKER_START.length).trim(),
      theirsLabel: lines[end]!.slice(MARKER_END.length).trim(),
      oursLines: lines.slice(i + 1, splitAt),
      theirsLines: lines.slice(mid + 1, end),
      baseLines
    });
    i = end + 1;
  }

  return blocks;
}

/**
 * Whether any conflict marker is left in `text`, well-formed or not. Different from
 * `parseConflictBlocks(text).length`: a half-deleted block (`<<<<<<<` with its
 * `=======` already gone) parses as nothing, so the count alone would call the file resolved while a marker still sits in it.
 */
export function hasConflictMarkers(text: string): boolean
{
  return text
    .split('\n')
    .some(
      (line) =>
        line.startsWith(MARKER_START) ||
        line.startsWith(MARKER_BASE) ||
        line === MARKER_MID ||
        line.startsWith(MARKER_END)
    );
}

export const CONFLICT_CHOICE_BASE = 'base';
export const CONFLICT_CHOICE_OURS = 'ours';
export const CONFLICT_CHOICE_THEIRS = 'theirs';
export const CONFLICT_CHOICE_OURS_THEN_THEIRS = 'oursThenTheirs';
export const CONFLICT_CHOICE_THEIRS_THEN_OURS = 'theirsThenOurs';

export type ConflictChoice =
  | typeof CONFLICT_CHOICE_BASE
  | typeof CONFLICT_CHOICE_OURS
  | typeof CONFLICT_CHOICE_THEIRS
  | typeof CONFLICT_CHOICE_OURS_THEN_THEIRS
  | typeof CONFLICT_CHOICE_THEIRS_THEN_OURS;

/**
 * Replace one block's marker lines with the side chosen for it. `block` must come from
 * parsing this exact `text`: its line numbers are only valid against it, which is why the caller re-parses after every accept.
 */
export function resolveConflictBlock(
  text: string,
  block: ConflictBlock,
  choice: ConflictChoice,
  baseLines: readonly string[] | null
): string
{
  const lines = text.split('\n');
  let replacement: readonly string[];
  switch (choice)
  {
    case CONFLICT_CHOICE_OURS:
      replacement = block.oursLines;
      break;
    case CONFLICT_CHOICE_THEIRS:
      replacement = block.theirsLines;
      break;
    case CONFLICT_CHOICE_OURS_THEN_THEIRS:
      replacement = [...block.oursLines, ...block.theirsLines];
      break;
    case CONFLICT_CHOICE_THEIRS_THEN_OURS:
      replacement = [...block.theirsLines, ...block.oursLines];
      break;
    default:
      replacement = baseLines ?? [];
      break;
  }
  lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...replacement);
  return lines.join('\n');
}
