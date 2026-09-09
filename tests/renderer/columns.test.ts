/**
 * The revision grid's column model.
 *
 * The cases worth testing are the ones that are awkward to reach with a mouse: a
 * layout persisted by a build that had different columns, a drag that ends where it
 * started, and a resize dragged past either limit.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  autoColumnWidth,
  gridTemplate,
  isHideable,
  isMovable,
  isResizable,
  moveColumn,
  normalizeColumns,
  setColumnVisible,
  setColumnWidth,
  visibleColumns,
  type ColumnState
} from '@renderer/columns.js';

const ids = (columns: readonly ColumnState[]): string[] => columns.map((c) => c.id);

describe('normalizeColumns', () =>
{
  it('produces the defaults for a config that has never been written', () =>
  {
    expect(normalizeColumns(null)).toEqual([...DEFAULT_COLUMNS]);
    expect(normalizeColumns(undefined)).toEqual([...DEFAULT_COLUMNS]);
  });

  it('ignores a stored value that is not an array', () =>
  {
    expect(normalizeColumns({ author: 200 })).toEqual([...DEFAULT_COLUMNS]);
    expect(normalizeColumns('graph,message')).toEqual([...DEFAULT_COLUMNS]);
  });

  it('keeps the stored order', () =>
  {
    const stored = [
      { id: 'graph', width: 0, visible: true },
      { id: 'sha', width: 90, visible: true },
      { id: 'message', width: 0, visible: true },
      { id: 'author', width: 160, visible: true },
      { id: 'date', width: 150, visible: true }
    ];
    expect(ids(normalizeColumns(stored))).toEqual(['graph', 'sha', 'message', 'author', 'date']);
  });

  // The two halves of surviving a config written by a different build.
  it('drops columns this build does not have', () =>
  {
    const stored = [
      { id: 'avatar', width: 32, visible: true },
      { id: 'buildStatus', width: 40, visible: true },
      { id: 'sha', width: 90, visible: true }
    ];
    expect(ids(normalizeColumns(stored))).toEqual(['sha', 'graph', 'message', 'author', 'date']);
  });

  it('appends columns the stored layout has never heard of, in default order', () =>
  {
    const stored = [{ id: 'message', width: 0, visible: true }];
    expect(ids(normalizeColumns(stored))).toEqual(['message', 'graph', 'author', 'date', 'sha']);
  });

  it('keeps only the first of a repeated column', () =>
  {
    const stored = [
      { id: 'sha', width: 90, visible: true },
      { id: 'sha', width: 200, visible: false }
    ];
    const result = normalizeColumns(stored);
    expect(result.filter((c) => c.id === 'sha')).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'sha', width: 90, visible: true });
  });

  it('clamps a width from a hand-edited config', () =>
  {
    const stored = [
      { id: 'author', width: 5000, visible: true },
      { id: 'date', width: 1, visible: true },
      { id: 'sha', width: Number.NaN, visible: true }
    ];
    const result = normalizeColumns(stored);
    expect(result.find((c) => c.id === 'author')!.width).toBe(MAX_COLUMN_WIDTH);
    expect(result.find((c) => c.id === 'date')!.width).toBe(MIN_COLUMN_WIDTH);
    // Not a number at all: fall back to the default rather than to a clamp of NaN.
    expect(result.find((c) => c.id === 'sha')!.width).toBeNull();
  });

  // The graph is sized by its lane count, so any stored width for it is meaningless:
  // it must come back auto rather than as a number that looks deliberate.
  it('discards a stored width for the graph column', () =>
  {
    const stored = [{ id: 'graph', width: 90, visible: true }];
    const result = normalizeColumns(stored);
    expect(result.find((c) => c.id === 'graph')!.width).toBeNull();
  });

  it('reads a missing width as auto', () =>
  {
    const result = normalizeColumns([{ id: 'author', visible: true }]);
    expect(result.find((c) => c.id === 'author')!.width).toBeNull();
  });

  it('clamps a stored message width just like any other resizable column', () =>
  {
    const stored = [{ id: 'message', width: 250, visible: true }];
    const result = normalizeColumns(stored);
    expect(result.find((c) => c.id === 'message')!.width).toBe(250);
  });

  it('treats a missing visible flag as visible', () =>
  {
    const stored = [{ id: 'sha' }, { id: 'author', visible: 'yes' }];
    const result = normalizeColumns(stored);
    expect(result.find((c) => c.id === 'sha')!.visible).toBe(true);
    expect(result.find((c) => c.id === 'author')!.visible).toBe(true);
  });

  it('refuses a stored layout that hides the message column', () =>
  {
    const stored = [{ id: 'message', width: 0, visible: false }];
    expect(normalizeColumns(stored).find((c) => c.id === 'message')!.visible).toBe(true);
  });

  it('survives entries that are not objects', () =>
  {
    expect(ids(normalizeColumns([null, 42, 'sha', { id: 'date', width: 150 }]))).toEqual([
      'date',
      'graph',
      'message',
      'author',
      'sha'
    ]);
  });
});

describe('column capabilities', () =>
{
  it('pins the graph column, not movable, not resizable, but hideable', () =>
  {
    expect(isMovable('graph')).toBe(false);
    expect(isResizable('graph')).toBe(false);
    expect(isHideable('graph')).toBe(true);
  });

  it('lets the message column move and be sized, but not hidden', () =>
  {
    expect(isMovable('message')).toBe(true);
    expect(isResizable('message')).toBe(true);
    expect(isHideable('message')).toBe(false);
  });
});

describe('setColumnWidth', () =>
{
  it('clamps to the limits', () =>
  {
    expect(setColumnWidth(DEFAULT_COLUMNS, 'author', 10).find((c) => c.id === 'author')!.width).toBe(
      MIN_COLUMN_WIDTH
    );
    expect(
      setColumnWidth(DEFAULT_COLUMNS, 'author', 9999).find((c) => c.id === 'author')!.width
    ).toBe(MAX_COLUMN_WIDTH);
  });

  it('rounds, so a sub-pixel drag does not persist a fractional width', () =>
  {
    expect(
      setColumnWidth(DEFAULT_COLUMNS, 'date', 150.6).find((c) => c.id === 'date')!.width
    ).toBe(151);
  });

  it('ignores the graph column, which has no width to set', () =>
  {
    expect(setColumnWidth(DEFAULT_COLUMNS, 'graph', 300)).toEqual([...DEFAULT_COLUMNS]);
  });
});

describe('setColumnVisible', () =>
{
  it('hides and shows', () =>
  {
    const hidden = setColumnVisible(DEFAULT_COLUMNS, 'sha', false);
    expect(hidden.find((c) => c.id === 'sha')!.visible).toBe(false);
    expect(ids(visibleColumns(hidden))).toEqual(['graph', 'message', 'author', 'date']);
    expect(setColumnVisible(hidden, 'sha', true).find((c) => c.id === 'sha')!.visible).toBe(true);
  });

  it('refuses to hide the message column', () =>
  {
    expect(setColumnVisible(DEFAULT_COLUMNS, 'message', false)).toEqual([...DEFAULT_COLUMNS]);
  });
});

describe('moveColumn', () =>
{
  it('moves a column in front of another', () =>
  {
    expect(ids(moveColumn(DEFAULT_COLUMNS, 'sha', 'author'))).toEqual([
      'graph',
      'message',
      'sha',
      'author',
      'date'
    ]);
  });

  it('moves a column to the end when there is nothing to sit in front of', () =>
  {
    expect(ids(moveColumn(DEFAULT_COLUMNS, 'message', null))).toEqual([
      'graph',
      'author',
      'date',
      'sha',
      'message'
    ]);
  });

  it('leaves the order alone when a column is dropped on itself', () =>
  {
    expect(moveColumn(DEFAULT_COLUMNS, 'date', 'date')).toEqual([...DEFAULT_COLUMNS]);
  });

  it('refuses to move the pinned graph column, or to move anything before it', () =>
  {
    expect(moveColumn(DEFAULT_COLUMNS, 'graph', 'sha')).toEqual([...DEFAULT_COLUMNS]);
    expect(moveColumn(DEFAULT_COLUMNS, 'sha', 'graph')).toEqual([...DEFAULT_COLUMNS]);
  });

  it('returns the list unchanged for a column that is not there', () =>
  {
    const without = DEFAULT_COLUMNS.filter((c) => c.id !== 'sha');
    expect(moveColumn(without, 'sha', 'date')).toEqual(without);
  });
});

describe('autoColumnWidth', () =>
{
  it('hands a dragged column back to its content', () =>
  {
    const dragged = setColumnWidth(DEFAULT_COLUMNS, 'author', 300);
    expect(autoColumnWidth(dragged, 'author').find((c) => c.id === 'author')!.width).toBeNull();
  });

  it('ignores the graph column, which has no width to clear', () =>
  {
    expect(autoColumnWidth(DEFAULT_COLUMNS, 'graph')).toEqual([...DEFAULT_COLUMNS]);
  });
});

describe('gridTemplate', () =>
{
  const measured = { author: 91, date: 104, sha: 57 };

  it('sizes the graph from the gutter, the message from the rest, and the others from their content', () =>
  {
    expect(gridTemplate(DEFAULT_COLUMNS, 84, measured)).toBe(
      '84px minmax(0px, 1fr) 91px 104px 57px'
    );
  });

  it('prefers a dragged width over what the content measures', () =>
  {
    const dragged = setColumnWidth(DEFAULT_COLUMNS, 'author', 300);
    expect(gridTemplate(dragged, 84, measured)).toBe('84px minmax(0px, 1fr) 300px 104px 57px');
  });

  // Before the first batch lands there is nothing to measure, and a column of 0 would
  // take the header's own label with it.
  it('falls back to the minimum for a column nothing has measured yet', () =>
  {
    expect(gridTemplate(DEFAULT_COLUMNS, 84)).toBe(
      `84px minmax(0px, 1fr) ${MIN_COLUMN_WIDTH}px ${MIN_COLUMN_WIDTH}px ${MIN_COLUMN_WIDTH}px`
    );
  });

  it('uses a set minimum when message has a stored width', () =>
  {
    const withWidth = setColumnWidth(DEFAULT_COLUMNS, 'message', 200);
    expect(gridTemplate(withWidth, 84, measured)).toBe(
      '84px minmax(200px, 1fr) 91px 104px 57px'
    );
  });

  it('drops hidden columns entirely', () =>
  {
    const hidden = setColumnVisible(setColumnVisible(DEFAULT_COLUMNS, 'sha', false), 'date', false);
    expect(gridTemplate(hidden, 84, measured)).toBe('84px minmax(0px, 1fr) 91px');
  });

  it('follows the column order', () =>
  {
    expect(gridTemplate(moveColumn(DEFAULT_COLUMNS, 'sha', 'message'), 28, measured)).toBe(
      '28px 57px minmax(0px, 1fr) 91px 104px'
    );
  });
});
