import { describe, expect, it } from 'vitest';
import { parseConflictBlocks } from '@renderer/model/conflictMarkers.js';
import { conflictRegions } from '@renderer/model/conflictRegions.js';

/** Blocks always come from a parse of the text they are coloured over: never hand-built. */
function regionsOf(lines: string[])
{
  return conflictRegions(parseConflictBlocks(lines.join('\n')));
}

describe('conflictRegions', () =>
{
  it('cuts a default-style block into markers and two sides', () =>
  {
    expect(
      regionsOf(['one', '<<<<<<< HEAD', 'a', 'b', '=======', 'c', '>>>>>>> feature', 'two'])
    ).toEqual([
      { kind: 'marker', startLine: 2, endLine: 2 },
      { kind: 'ours', startLine: 3, endLine: 4 },
      { kind: 'marker', startLine: 5, endLine: 5 },
      { kind: 'theirs', startLine: 6, endLine: 6 },
      { kind: 'marker', startLine: 7, endLine: 7 }
    ]);
  });

  it('gives the diff3 ancestor its own region, and ends ours at its marker', () =>
  {
    expect(
      regionsOf([
        '<<<<<<< HEAD',
        'a',
        '||||||| merged common ancestors',
        'base',
        '=======',
        'c',
        '>>>>>>> feature'
      ])
    ).toEqual([
      { kind: 'marker', startLine: 1, endLine: 1 },
      { kind: 'ours', startLine: 2, endLine: 2 },
      { kind: 'marker', startLine: 3, endLine: 3 },
      { kind: 'base', startLine: 4, endLine: 4 },
      { kind: 'marker', startLine: 5, endLine: 5 },
      { kind: 'theirs', startLine: 6, endLine: 6 },
      { kind: 'marker', startLine: 7, endLine: 7 }
    ]);
  });

  it('draws no region for a side that has no lines', () =>
  {
    // One branch deleted what the other changed: the two markers simply meet, and a
    // zero-height region would tint the wrong line.
    expect(regionsOf(['<<<<<<< HEAD', '=======', 'c', '>>>>>>> feature'])).toEqual([
      { kind: 'marker', startLine: 1, endLine: 1 },
      { kind: 'marker', startLine: 2, endLine: 2 },
      { kind: 'theirs', startLine: 3, endLine: 3 },
      { kind: 'marker', startLine: 4, endLine: 4 }
    ]);
  });

  it('keeps several blocks in file order', () =>
  {
    const regions = regionsOf([
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> feature',
      'clean',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> feature'
    ]);
    expect(regions.map((region) => region.startLine)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
    // Nothing is coloured over the clean line between them.
    expect(regions.some((region) => region.startLine <= 6 && region.endLine >= 6)).toBe(false);
  });

  it('finds nothing in a clean file', () =>
  {
    expect(regionsOf(['one', 'two'])).toEqual([]);
  });
});
