/**
 * Selecting paths in the commit screen's lists.
 *
 * The same reasoning as `tests/renderer/selection.test.ts` for the grid: anchored range extension
 * has four awkward cases, and the ones that matter here are the ones the grid does not
 * have: a range measured against a *drawn* order that a tree, a grouping or a filter
 * has reshaped, and a folderful of paths picked in one go.
 *
 * These are plain functions over plain data precisely so this file can exist: the
 * staging store imports `api`, which reads `window.git` at import time and cannot be
 * loaded under Node.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  pickPath,
  pickPaths,
  stepPath,
  type PathSelection
} from '@renderer/pathSelection.js';

/** A flat list, as a plain list would draw it. */
const FLAT = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];

const at = (picks: string[], anchor: string | null = picks[picks.length - 1] ?? null): PathSelection => ({
  picks,
  anchor
});

describe('one path at a time', () =>
{
  it('replaces the selection and moves the anchor', () =>
  {
    const first = pickPath(EMPTY_SELECTION, 'b.ts', 'replace', FLAT);
    expect(first).toEqual({ picks: ['b.ts'], anchor: 'b.ts' });

    const second = pickPath(first, 'd.ts', 'replace', FLAT);
    expect(second).toEqual({ picks: ['d.ts'], anchor: 'd.ts' });
  });

  it('adds and removes one path on a toggle, leaving the rest alone', () =>
  {
    const two = pickPath(pickPath(EMPTY_SELECTION, 'a.ts', 'replace', FLAT), 'c.ts', 'toggle', FLAT);
    expect(two.picks).toEqual(['a.ts', 'c.ts']);

    expect(pickPath(two, 'a.ts', 'toggle', FLAT).picks).toEqual(['c.ts']);
  });
});

describe('a range', () =>
{
  it('runs from the anchor to the row clicked, inclusive', () =>
  {
    const anchored = pickPath(EMPTY_SELECTION, 'b.ts', 'replace', FLAT);
    expect(pickPath(anchored, 'd.ts', 'range', FLAT).picks).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('records a backwards range from the anchor, so the row clicked is the last pick', () =>
  {
    const anchored = pickPath(EMPTY_SELECTION, 'd.ts', 'replace', FLAT);
    const range = pickPath(anchored, 'b.ts', 'range', FLAT);
    expect(range.picks).toEqual(['d.ts', 'c.ts', 'b.ts']);
    // The last pick is the file the diff pane shows: the end you dragged to.
    expect(range.picks[range.picks.length - 1]).toBe('b.ts');
  });

  it('leaves the anchor put, so a second shift-click shrinks the same range', () =>
  {
    const anchored = pickPath(EMPTY_SELECTION, 'b.ts', 'replace', FLAT);
    const wide = pickPath(anchored, 'e.ts', 'range', FLAT);
    expect(wide.anchor).toBe('b.ts');
    expect(pickPath(wide, 'c.ts', 'range', FLAT).picks).toEqual(['b.ts', 'c.ts']);
  });

  it('behaves as a plain click when there is no anchor, or it is no longer drawn', () =>
  {
    expect(pickPath(EMPTY_SELECTION, 'c.ts', 'range', FLAT)).toEqual({
      picks: ['c.ts'],
      anchor: 'c.ts'
    });
    // The anchored file has been staged out from under the selection.
    const stale = at(['gone.ts']);
    expect(pickPath(stale, 'c.ts', 'range', FLAT).picks).toEqual(['c.ts']);
  });

  it('measures against the drawn order, not the underlying one', () =>
  {
    // What a tree draws: folders first, files sorted inside them.
    const drawn = ['src/a.ts', 'src/b.ts', 'README.md'];
    const anchored = pickPath(EMPTY_SELECTION, 'src/b.ts', 'replace', drawn);
    expect(pickPath(anchored, 'README.md', 'range', drawn).picks).toEqual([
      'src/b.ts',
      'README.md'
    ]);
  });

  it('cannot pick a row the filter box is hiding', () =>
  {
    const shown = ['a.ts', 'c.ts'];
    const anchored = pickPath(EMPTY_SELECTION, 'a.ts', 'replace', shown);
    expect(pickPath(anchored, 'c.ts', 'range', shown).picks).toEqual(['a.ts', 'c.ts']);
  });
});

describe('a folderful at once', () =>
{
  const folder = ['src/a.ts', 'src/b.ts'];

  it('replaces the selection with the folder, anchoring on its last file', () =>
  {
    expect(pickPaths(at(['README.md']), folder, 'replace')).toEqual({
      picks: folder,
      anchor: 'src/b.ts'
    });
  });

  it('adds a folder to what is already picked', () =>
  {
    expect(pickPaths(at(['README.md']), folder, 'toggle').picks).toEqual([
      'README.md',
      ...folder
    ]);
  });

  it('completes a half-picked folder rather than dropping the half that is picked', () =>
  {
    expect(pickPaths(at(['src/a.ts']), folder, 'toggle').picks).toEqual(folder);
  });

  it('drops a folder that is wholly picked, and moves the anchor off it', () =>
  {
    const both = pickPaths(at(['README.md']), folder, 'toggle');
    const dropped = pickPaths(both, folder, 'toggle');
    expect(dropped).toEqual({ picks: ['README.md'], anchor: 'README.md' });
  });

  it('leaves an empty folder alone rather than clearing the selection', () =>
  {
    const before = at(['README.md']);
    expect(pickPaths(before, [], 'replace')).toBe(before);
  });
});

describe('stepping with the arrow keys', () =>
{
  it('moves one row along the drawn list and stops at both ends', () =>
  {
    expect(stepPath(at(['b.ts']), 'b.ts', 1, FLAT).picks).toEqual(['c.ts']);
    expect(stepPath(at(['a.ts']), 'a.ts', -1, FLAT).picks).toEqual(['a.ts']);
    expect(stepPath(at(['e.ts']), 'e.ts', 1, FLAT).picks).toEqual(['e.ts']);
  });

  it('starts from the row the diff pane is showing, which may be no pick at all', () =>
  {
    // Nothing picked: the pane falls back to the first row, so ↓ lands on the second.
    expect(stepPath(EMPTY_SELECTION, 'a.ts', 1, FLAT).picks).toEqual(['b.ts']);
  });

  it('extends from the anchor when told to, and keeps extending from it', () =>
  {
    const anchored = pickPath(EMPTY_SELECTION, 'b.ts', 'replace', FLAT);
    const one = stepPath(anchored, 'b.ts', 1, FLAT, true);
    expect(one.picks).toEqual(['b.ts', 'c.ts']);

    const two = stepPath(one, 'c.ts', 1, FLAT, true);
    expect(two.picks).toEqual(['b.ts', 'c.ts', 'd.ts']);
    expect(two.anchor).toBe('b.ts');
  });

  it('does nothing at all in an empty list', () =>
  {
    const before = at(['a.ts']);
    expect(stepPath(before, 'a.ts', 1, [])).toBe(before);
  });
});
