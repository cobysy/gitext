/**
 * Which conflict blocks a word-level merge can settle, and what it settles them to.
 * `wordMerge.ts` does the merging and knows nothing about conflicts; this knows about
 * conflicts and does no merging. The awkward part: a three-way merge needs the common
 * ancestor, but git's **default** marker style doesn't write one into the file, so the
 * base region is worked out by anchoring on the clean lines around the block, walking
 * forwards through the base so a repeated line can't pull an anchor backwards.
 * **Anything uncertain gives up**: no anchor, an anchor absent from the base, or
 * colliding sides all mean "no suggestion", leaving the block for a person to decide.
 */

import { findLineRange } from './conflictBlame.js';
import type { ConflictBlock } from './conflictMarkers.js';
import { threeWayWordMerge } from './wordMerge.js';

/**
 * How many clean lines on each side of a block to anchor with. More than one, since a
 * single `}` or blank line appears everywhere; not many more, since the run has to
 * *exist* and the walk below shortens the anchor rather than giving up when it doesn't.
 */
const ANCHOR_LINES = 3;

export interface AutoMergeSuggestion {
  /** Index into the block list this was computed from. */
  blockIndex: number;
  /** What the block's lines become: already split, ready to splice in. */
  mergedLines: string[];
}

/**
 * The base region for one block, as a half-open line range, or null when the anchors
 * couldn't place it. `searchFrom` is where the previous block ended in the base, so a repeated line can't match an earlier occurrence and put two blocks' regions out of order.
 */
function locateBaseRegion(
  workingLines: readonly string[],
  block: ConflictBlock,
  baseLines: readonly string[],
  searchFrom: number
): { start: number; end: number } | null
{
  // The clean lines immediately above the `<<<<<<<` marker, longest run first: a longer anchor is more certain, but a shorter one is worth trying before giving up.
  const beforeEnd = block.startLine - 1;
  let start: number | null = null;
  for (let size = Math.min(ANCHOR_LINES, beforeEnd); size >= 1; size -= 1)
  {
    const anchor = workingLines.slice(beforeEnd - size, beforeEnd);
    const found = findLineRange(baseLines, anchor, searchFrom);
    if (found)
    {
      start = found.end + 1;
      break;
    }
  }
  if (start === null)
  {
    // No anchor above at all means the block starts the file, and the base region with it. Anything else is an anchor that should have been found and wasn't.
    if (beforeEnd > 0)
    {
      return null;
    }
    start = searchFrom;
  }

  const afterStart = block.endLine;
  let end: number | null = null;
  for (let size = Math.min(ANCHOR_LINES, workingLines.length - afterStart); size >= 1; size -= 1)
  {
    const anchor = workingLines.slice(afterStart, afterStart + size);
    const found = findLineRange(baseLines, anchor, start);
    if (found)
    {
      end = found.start;
      break;
    }
  }
  if (end === null)
  {
    if (afterStart < workingLines.length)
    {
      return null;
    }
    end = baseLines.length;
  }

  if (end < start)
  {
    return null;
  }
  return { start, end };
}

/**
 * Every block a word-level merge can settle, with what it settles it to. `baseText` is
 * the whole base blob: null for an add/add conflict, which has no common ancestor. A
 * block carrying its own `baseLines` (diff3-style) uses those and isn't anchored at all.
 */
export function suggestAutoMerges(
  workingText: string,
  blocks: readonly ConflictBlock[],
  baseText: string | null
): AutoMergeSuggestion[]
{
  const workingLines = workingText.split('\n');
  const baseLines = baseText?.split('\n') ?? null;
  const suggestions: AutoMergeSuggestion[] = [];
  let searchFrom = 0;

  blocks.forEach((block, blockIndex) =>
  {
    let region: readonly string[] | null = block.baseLines;
    if (!region)
    {
      if (!baseLines)
      {
        return;
      }
      const located = locateBaseRegion(workingLines, block, baseLines, searchFrom);
      if (!located)
      {
        return;
      }
      searchFrom = located.end;
      region = baseLines.slice(located.start, located.end);
    }

    const merged = threeWayWordMerge(
      region.join('\n'),
      block.oursLines.join('\n'),
      block.theirsLines.join('\n')
    );
    if (merged === null)
    {
      return;
    }
    // A "merge" that just reproduces one side isn't worth offering as a third option: that side's own button already does it, more plainly.
    if (merged === block.oursLines.join('\n') || merged === block.theirsLines.join('\n'))
    {
      return;
    }
    suggestions.push({ blockIndex, mergedLines: merged.split('\n') });
  });

  return suggestions;
}
