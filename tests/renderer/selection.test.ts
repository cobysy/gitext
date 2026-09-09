/**
 * Selection in the revision grid.
 *
 * Worth unit-testing rather than clicking through: anchored range extension has four
 * awkward cases (backwards ranges, a re-shift-click shrinking the range, an anchor that
 * is no longer loaded, no anchor at all), and the whole point of keying selection by
 * SHA is behaviour that only shows up *after* a reload, which is tedious to reproduce
 * by hand and trivial to assert here.
 *
 * Assertions go through `ordered` (pick order) or `inDisplayOrder` (grid order) rather
 * than iterating `selected`, so that a change to how the membership set is built cannot
 * quietly change what a two-commit command would receive.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSelectionStore } from '@renderer/stores/selection.js';

/** Rows in display order. Only `sha` matters to the store. */
const rows = (...shas: string[]): { sha: string }[] => shas.map((sha) => ({ sha }));

const history = rows('a', 'b', 'c', 'd', 'e');

beforeEach(() =>
{
  setActivePinia(createPinia());
});

describe('single selection', () =>
{
  it('replaces the selection and moves the anchor', () =>
  {
    const selection = useSelectionStore();

    selection.select('b');
    expect(selection.ordered).toEqual(['b']);
    expect(selection.primary).toBe('b');
    expect(selection.anchor).toBe('b');

    selection.select('d');
    expect(selection.ordered).toEqual(['d']);
    expect(selection.anchor).toBe('d');
  });

  it('starts empty and clears back to empty', () =>
  {
    const selection = useSelectionStore();
    expect(selection.isEmpty).toBe(true);

    selection.select('a');
    selection.clear();

    expect(selection.isEmpty).toBe(true);
    expect(selection.primary).toBeNull();
    expect(selection.anchor).toBeNull();
  });
});

describe('toggling', () =>
{
  it('adds without disturbing the rest, and makes the added one primary', () =>
  {
    const selection = useSelectionStore();

    selection.select('a');
    selection.toggle('c');

    expect(selection.inDisplayOrder(history)).toEqual(['a', 'c']);
    // Pick order, not grid order: 'c' was clicked second, so it leads.
    expect(selection.ordered).toEqual(['c', 'a']);
    expect(selection.primary).toBe('c');
  });

  it('moves primary to something still selected when primary is toggled off', () =>
  {
    const selection = useSelectionStore();

    selection.select('a');
    selection.toggle('c');
    selection.toggle('c');

    expect(selection.ordered).toEqual(['a']);
    expect(selection.primary).toBe('a');
  });

  it('leaves nothing primary when the last selected row is toggled off', () =>
  {
    const selection = useSelectionStore();

    selection.select('a');
    selection.toggle('a');

    expect(selection.isEmpty).toBe(true);
    expect(selection.primary).toBeNull();
  });
});

describe('range extension', () =>
{
  it('selects everything between the anchor and the target', () =>
  {
    const selection = useSelectionStore();

    selection.select('b');
    selection.extendTo('d', history);

    expect(selection.inDisplayOrder(history)).toEqual(['b', 'c', 'd']);
    expect(selection.primary).toBe('d');
  });

  it('works upwards as well as downwards', () =>
  {
    const selection = useSelectionStore();

    selection.select('d');
    selection.extendTo('b', history);

    expect(selection.inDisplayOrder(history)).toEqual(['b', 'c', 'd']);
    // Dragged upwards, so the top of the range is the end being looked at.
    expect(selection.primary).toBe('b');
  });

  it('keeps the anchor put, so a second shift-click reshapes one range', () =>
  {
    const selection = useSelectionStore();

    selection.select('b');
    selection.extendTo('e', history);
    selection.extendTo('c', history);

    expect(selection.inDisplayOrder(history)).toEqual(['b', 'c']);
    expect(selection.anchor).toBe('b');
  });

  it('behaves as a plain click when there is no anchor', () =>
  {
    const selection = useSelectionStore();

    selection.extendTo('c', history);

    expect(selection.ordered).toEqual(['c']);
    expect(selection.anchor).toBe('c');
  });

  it('behaves as a plain click when the anchor is no longer loaded', () =>
  {
    const selection = useSelectionStore();

    selection.select('zz');
    selection.extendTo('c', history);

    expect(selection.ordered).toEqual(['c']);
    expect(selection.anchor).toBe('c');
  });

  it('ignores a target that is not in the list at all', () =>
  {
    const selection = useSelectionStore();

    selection.select('b');
    selection.extendTo('zz', history);

    expect(selection.ordered).toEqual(['b']);
  });
});

describe('ordering for two-commit commands', () =>
{
  // A rebase-onto reads `ordered[0]` as the *onto* and `ordered[1]` as the excluded
  // lower bound, so which SHA is which depends on click order,
  // and ctrl-clicking two commits far apart is the normal way to reach it.
  it('reports the second ctrl-click first, whichever way round the rows are', () =>
  {
    const selection = useSelectionStore();

    selection.select('d');
    selection.toggle('a');
    expect(selection.ordered).toEqual(['a', 'd']);

    selection.clear();
    selection.select('a');
    selection.toggle('d');
    expect(selection.ordered).toEqual(['d', 'a']);
  });

  it('gives a scattered selection back in grid order for range-shaped commands', () =>
  {
    const selection = useSelectionStore();

    selection.select('e');
    selection.toggle('b');
    selection.toggle('d');

    expect(selection.inDisplayOrder(history)).toEqual(['b', 'd', 'e']);
    // Cherry-pick applies oldest first, which is this reversed.
    expect([...selection.inDisplayOrder(history)].reverse()).toEqual(['e', 'd', 'b']);
  });

  it('ignores rows that are not selected and selections that are not in rows', () =>
  {
    const selection = useSelectionStore();

    selection.select('c');
    selection.toggle('zz');

    expect(selection.inDisplayOrder(history)).toEqual(['c']);
  });
});

describe('surviving a reload', () =>
{
  it('keeps commits that are still there', () =>
  {
    const selection = useSelectionStore();

    selection.select('b');
    selection.toggle('d');
    // A new commit landing on top moves every row down by one; SHA-keyed selection
    // does not care, which is the entire reason it is keyed that way.
    selection.retain(rows('new', 'a', 'b', 'c', 'd', 'e'));

    expect(selection.ordered).toEqual(['d', 'b']);
    expect(selection.primary).toBe('d');
  });

  it('drops commits that are gone and re-points primary at a survivor', () =>
  {
    const selection = useSelectionStore();

    selection.select('b');
    selection.toggle('e');
    selection.retain(rows('a', 'b', 'c'));

    expect(selection.ordered).toEqual(['b']);
    expect(selection.primary).toBe('b');
    expect(selection.anchor).toBe('b');
  });

  it('empties out when nothing selected survived', () =>
  {
    const selection = useSelectionStore();

    selection.select('e');
    selection.retain(rows('x', 'y'));

    expect(selection.isEmpty).toBe(true);
    expect(selection.primary).toBeNull();
    expect(selection.anchor).toBeNull();
  });

  it('does nothing at all when nothing is selected', () =>
  {
    const selection = useSelectionStore();

    selection.retain(history);

    expect(selection.isEmpty).toBe(true);
  });
});
