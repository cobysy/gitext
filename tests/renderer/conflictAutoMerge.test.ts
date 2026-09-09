import { describe, expect, it } from 'vitest';
import { parseConflictBlocks } from '@renderer/model/conflictMarkers.js';
import { suggestAutoMerges } from '@renderer/model/conflictAutoMerge.js';

/** The shape git leaves on disk under its default `merge` conflict style. */
function conflicted(before: string[], ours: string[], theirs: string[], after: string[]): string
{
  return [
    ...before,
    '<<<<<<< HEAD',
    ...ours,
    '=======',
    ...theirs,
    '>>>>>>> feature',
    ...after
  ].join('\n');
}

describe('suggestAutoMerges', () =>
{
  it('settles a block whose two sides edited different words of one line', () =>
  {
    const base = ['Pancakes', '2 cups flour', '1 tsp salt', '2 eggs'].join('\n');
    const working = conflicted(
      ['Pancakes', '2 cups flour'],
      ['2 tsp salt'],
      ['1 tsp sea salt'],
      ['2 eggs']
    );
    const blocks = parseConflictBlocks(working);

    const suggestions = suggestAutoMerges(working, blocks, base);
    expect(suggestions).toEqual([{ blockIndex: 0, mergedLines: ['2 tsp sea salt'] }]);
  });

  it('offers nothing when the two sides edited the same word', () =>
  {
    const base = ['a', '1 tsp salt', 'z'].join('\n');
    const working = conflicted(['a'], ['2 tsp salt'], ['3 tsp salt'], ['z']);
    expect(suggestAutoMerges(working, parseConflictBlocks(working), base)).toEqual([]);
  });

  it('offers nothing when the merge would just reproduce one side', () =>
  {
    // That side's own button already does this, and says so more plainly.
    const base = ['a', 'x', 'z'].join('\n');
    const working = conflicted(['a'], ['x'], ['y'], ['z']);
    expect(suggestAutoMerges(working, parseConflictBlocks(working), base)).toEqual([]);
  });

  it('offers nothing when there is no common ancestor at all', () =>
  {
    // An add/add conflict: nothing to merge over.
    const working = conflicted(['a'], ['ours'], ['theirs'], ['z']);
    expect(suggestAutoMerges(working, parseConflictBlocks(working), null)).toEqual([]);
  });

  it('uses the block’s own base when the file carries one (diff3 style)', () =>
  {
    const working = [
      'a',
      '<<<<<<< HEAD',
      '2 tsp salt',
      '||||||| merged common ancestors',
      '1 tsp salt',
      '=======',
      '1 tsp sea salt',
      '>>>>>>> feature',
      'z'
    ].join('\n');
    // No base blob passed at all: the file already says what the ancestor is.
    const suggestions = suggestAutoMerges(working, parseConflictBlocks(working), null);
    expect(suggestions).toEqual([{ blockIndex: 0, mergedLines: ['2 tsp sea salt'] }]);
  });

  it('handles two blocks in one file, anchoring each independently', () =>
  {
    const base = ['top', '1 tsp salt', 'middle', '2 cups flour', 'end'].join('\n');
    const working = [
      'top',
      '<<<<<<< HEAD',
      '2 tsp salt',
      '=======',
      '1 tsp sea salt',
      '>>>>>>> feature',
      'middle',
      '<<<<<<< HEAD',
      '3 cups flour',
      '=======',
      '2 cups plain flour',
      '>>>>>>> feature',
      'end'
    ].join('\n');
    const suggestions = suggestAutoMerges(working, parseConflictBlocks(working), base);
    expect(suggestions).toEqual([
      { blockIndex: 0, mergedLines: ['2 tsp sea salt'] },
      { blockIndex: 1, mergedLines: ['3 cups plain flour'] }
    ]);
  });

  it('anchors a block that starts the file, where there is nothing above it', () =>
  {
    const base = ['1 tsp salt', 'tail'].join('\n');
    const working = ['<<<<<<< HEAD', '2 tsp salt', '=======', '1 tsp sea salt', '>>>>>>> f', 'tail'].join(
      '\n'
    );
    expect(suggestAutoMerges(working, parseConflictBlocks(working), base)).toEqual([
      { blockIndex: 0, mergedLines: ['2 tsp sea salt'] }
    ]);
  });

  it('anchors a block that ends the file, where there is nothing below it', () =>
  {
    const base = ['head', '1 tsp salt'].join('\n');
    const working = ['head', '<<<<<<< HEAD', '2 tsp salt', '=======', '1 tsp sea salt', '>>>>>>> f'].join(
      '\n'
    );
    expect(suggestAutoMerges(working, parseConflictBlocks(working), base)).toEqual([
      { blockIndex: 0, mergedLines: ['2 tsp sea salt'] }
    ]);
  });

  it('gives up rather than guessing when the anchor is not in the base', () =>
  {
    // The lines around the block do not appear in this base at all, so where the block's
    // ancestor lies is unknown, and a guess would merge against the wrong text.
    const base = ['completely', 'different', 'file'].join('\n');
    const working = conflicted(['a'], ['2 tsp salt'], ['1 tsp sea salt'], ['z']);
    expect(suggestAutoMerges(working, parseConflictBlocks(working), base)).toEqual([]);
  });

  it('offers nothing for a file with no conflicts left', () =>
  {
    expect(suggestAutoMerges('a\nb\n', [], 'a\nb\n')).toEqual([]);
  });
});
