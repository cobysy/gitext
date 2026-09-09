/** `markAncestry`, which rows the graph draws lit rather than dimmed. */

import { describe, expect, it } from 'vitest';
import { markAncestry, markRelative } from '@renderer/model/graph/ancestry.js';
import type { GraphInputCommit } from '@renderer/model/graph/types.js';
import { INDEX_SHA, WORKING_TREE_SHA } from '@shared/artificial.js';

/**
 * Build a commit list from a compact `"sha: parent parent"` notation, so a test
 * reads as the topology it describes rather than as object literals.
 */
function commits(...spec: string[]): GraphInputCommit[]
{
  return spec.map((line) =>
  {
    const [sha, rest] = line.split(':');
    return {
      sha: sha!.trim(),
      parents: (rest ?? '').trim().split(/\s+/).filter(Boolean)
    };
  });
}

describe('markAncestry', () =>
{
  /** The rows a mark array names, as SHAs, so an expectation reads as a topology. */
  function marked(input: GraphInputCommit[], seed: string | number): string[]
  {
    const rowOf = (sha: string): number | undefined =>
    {
      const index = input.findIndex((c) => c.sha === sha);
      if (index === -1)
      {
        return undefined;
      }
      else
      {
        return index;
      }
    };
    let seedRow;
    if (typeof seed === 'number')
    {
      seedRow = seed;
    }
    else
    {
      seedRow = rowOf(seed) ?? -1;
    }
    const marks = markAncestry(input, rowOf, seedRow);
    return input.filter((_, i) => marks[i] === 1).map((c) => c.sha);
  }

  it('marks the whole history from the tip of a linear one', () =>
  {
    expect(marked(commits('c: b', 'b: a', 'a:'), 'c')).toEqual(['c', 'b', 'a']);
  });

  it('marks only downwards from mid-history', () =>
  {
    // Descendants are deliberately excluded: the seed is where you are, and what came
    // after it is not what you are on.
    expect(marked(commits('c: b', 'b: a', 'a:'), 'b')).toEqual(['b', 'a']);
  });

  it('marks both sides of a merge, not just the first parent', () =>
  {
    //   m
    //   |\
    //   f |
    //   | /
    //   b
    expect(marked(commits('m: f b', 'f: b', 'b:'), 'm')).toEqual(['m', 'f', 'b']);
  });

  it('leaves a sibling branch off the seeded ancestry unmarked', () =>
  {
    // `side` descends from `base` but is not an ancestor of `tip`, so it stays dim:
    // the case the whole feature exists for.
    const input = commits('tip: base', 'side: base', 'base:');
    expect(marked(input, 'tip')).toEqual(['tip', 'base']);
  });

  it('reaches HEAD’s ancestry through an artificial row', () =>
  {
    // Seeding from the working tree must light the branch below it, or the graph would
    // dim everything the moment the working-tree row was the seed.
    const input = [
      { sha: WORKING_TREE_SHA, parents: [INDEX_SHA] },
      { sha: INDEX_SHA, parents: ['head'] },
      ...commits('head: b', 'b:')
    ];
    expect(marked(input, WORKING_TREE_SHA)).toEqual([WORKING_TREE_SHA, INDEX_SHA, 'head', 'b']);
  });

  it('skips parents outside the loaded range', () =>
  {
    // What a commit limit produces. The unloaded parent simply cannot be marked.
    expect(marked(commits('c: b', 'b: cut-off-here'), 'c')).toEqual(['c', 'b']);
  });

  it('returns an empty array for a seed it cannot place', () =>
  {
    // Length zero, not a full-length array of zeros: the canvas reads the former as
    // "dim nothing" and the latter as "dim everything". A detached HEAD takes this path.
    const input = commits('c: b', 'b: a', 'a:');
    expect(markAncestry(input, () => undefined, -1)).toHaveLength(0);
    expect(markAncestry(input, () => undefined, 99)).toHaveLength(0);
  });

  it('marks nothing beyond the seed when the seed is the last row', () =>
  {
    expect(marked(commits('c: b', 'b: a', 'a:'), 'a')).toEqual(['a']);
  });
});

describe('markRelative', () =>
{
  // The read side of the same signal, and the reason the zero-length array above is not
  // an oversight: with no seed every row is relative, which is what "dim nothing" is.
  it('treats the no-seed array as everything being relative', () =>
  {
    const noSeed = new Uint8Array(0);
    expect(markRelative(noSeed, 0)).toBe(true);
    expect(markRelative(noSeed, 999)).toBe(true);
  });

  it('reads a real mark array row by row', () =>
  {
    const marks = Uint8Array.from([1, 0, 1]);
    expect([0, 1, 2].map((row) => markRelative(marks, row))).toEqual([true, false, true]);
  });
});
