/** Which rows are ancestors of one commit: what the graph draws in full colour. */

import type { GraphInputCommit } from './types.js';

/**
 * Mark rows that are ancestors of seedRow (walks all parents for merge highlighting).
 * One top-to-bottom sweep (fast); out-of-range seed returns zero-length array.
 */
export function markAncestry(
  rows: readonly GraphInputCommit[],
  rowOf: (sha: string) => number | undefined,
  seedRow: number
): Uint8Array
{
  if (seedRow < 0 || seedRow >= rows.length)
  {
    return new Uint8Array(0);
  }

  const marked = new Uint8Array(rows.length);

  marked[seedRow] = 1;
  for (let i = seedRow; i < rows.length; i++)
  {
    if (!marked[i])
    {
      continue;
    }
    for (const parent of rows[i]!.parents)
    {
      const row = rowOf(parent);
      // Marked even if it somehow sits above `i`, where the sweep has already passed
      // and cannot carry it further. Ordering that broken would need a log order git
      // does not produce; marking anyway keeps one such row out of the *wrong* set,
      // which is worth more than the propagation it cannot do from there.
      if (row !== undefined)
      {
        marked[row] = 1;
      }
    }
  }
  return marked;
}

/**
 * Read one row's mark, treating the zero-length "no seed" array as *everything is
 * relative*: with nothing highlighted, nothing is dimmed.
 */
export function markRelative(marked: Uint8Array, row: number): boolean
{
  return marked.length === 0 || marked[row] === 1;
}
