/**
 * The revision grid's column model: which columns exist, in what order, how wide, and
 * which are shown. Pure: no DOM, no store. Drag handling belongs to the component; the
 * arithmetic it commits belongs here, where the easy-to-get-wrong cases (a stale
 * persisted layout, dragging a column onto itself, resizing below its own header) are unit tests, not mouse work.
 *
 * One `gridTemplate` feeds both the header row and every body row, for the same
 * reason one `buildArgs` feeds preview and runner (§8): two separately-built layouts drift.
 */

export const COLUMN_GRAPH = 'graph' as const;
export const COLUMN_MESSAGE = 'message' as const;
export const COLUMN_AUTHOR = 'author' as const;
export const COLUMN_DATE = 'date' as const;
export const COLUMN_SHA = 'sha' as const;

export type ColumnId =
  | typeof COLUMN_GRAPH
  | typeof COLUMN_MESSAGE
  | typeof COLUMN_AUTHOR
  | typeof COLUMN_DATE
  | typeof COLUMN_SHA;

export interface ColumnState {
  id: ColumnId;
  /**
   * Width in pixels, or `null` for "as wide as its content needs": the state a
   * column is in until dragged, and returns to on double-click. `graph` is always
   * `null`; `message` treats a width as a minimum, not a size.
   */
  width: number | null;
  visible: boolean;
}

/**
 * Order here is the default order, and the order unknown-to-stored columns are
 * appended in when a later build adds one.
 */
export const DEFAULT_COLUMNS: readonly ColumnState[] = [
  { id: 'graph', width: null, visible: true },
  { id: 'message', width: null, visible: true },
  { id: 'author', width: null, visible: true },
  { id: 'date', width: null, visible: true },
  { id: 'sha', width: null, visible: true }
];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  graph: 'Revision Graph',
  message: 'Message',
  author: 'Author',
  date: 'Date',
  sha: 'SHA-1'
};

/** Narrow enough to be worth doing, wide enough that the header label survives. */
export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 600;

/**
 * The graph is pinned first and sized by its lane count, not by the user: it annotates
 * the message beside it, so a graph column between Author and Date would describe nothing.
 */
export function isMovable(id: ColumnId): boolean
{
  return id !== COLUMN_GRAPH;
}

/** True when `width` is a finite number worth restoring for a resizable column. */
function isStoredWidthUsable(id: ColumnId, width: unknown): width is number
{
  return isResizable(id) && typeof width === 'number' && Number.isFinite(width);
}

export function isResizable(id: ColumnId): boolean
{
  return id !== COLUMN_GRAPH;
}

/** Hiding the message column would leave a grid of dates with nothing to read. */
export function isHideable(id: ColumnId): boolean
{
  return id !== COLUMN_MESSAGE;
}

function isColumnId(value: unknown): value is ColumnId
{
  return typeof value === 'string' && value in COLUMN_LABELS;
}

/**
 * Reconcile a persisted layout with the columns this build actually has. Settings
 * merge shallowly over defaults, so a stale `gridColumns` array can name a column that
 * no longer exists, omit one that now does, repeat one, or carry a hand-edited width.
 * Unrecognised is dropped, missing is appended in default order, widths are clamped.
 */
export function normalizeColumns(value: unknown): ColumnState[]
{
  let stored;
  if (Array.isArray(value))
  {
    stored = value;
  }
  else
  {
    stored = [];
  }
  const result: ColumnState[] = [];
  const seen = new Set<ColumnId>();

  for (const entry of stored)
  {
    if (typeof entry !== 'object' || entry === null)
    {
      continue;
    }
    const { id, width, visible } = entry as Partial<ColumnState>;
    if (!isColumnId(id) || seen.has(id))
    {
      continue;
    }

    seen.add(id);
    // The graph is sized by its lane count, so any stored width for it is noise:
    // reading it back would be treating a number that means nothing as deliberate.
    let storedWidth: number | null;
    if (isStoredWidthUsable(id, width))
    {
      storedWidth = clamp(width);
    }
    else
    {
      storedWidth = null;
    }
    // Only `false` hides a column: a missing/non-boolean flag predates the field, and
    // absence is worse than shown. A stored `false` on a column that can't be hidden is discarded, not obeyed.
    let storedVisible: boolean;
    if (visible === false)
    {
      storedVisible = !isHideable(id);
    }
    else
    {
      storedVisible = true;
    }
    result.push({
      id,
      width: storedWidth,
      visible: storedVisible
    });
  }

  for (const column of DEFAULT_COLUMNS)
  {
    if (!seen.has(column.id))
    {
      result.push({ ...column });
    }
  }

  return result;
}

function clamp(width: number): number
{
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

export function visibleColumns(columns: readonly ColumnState[]): ColumnState[]
{
  return columns.filter((c) => c.visible);
}

export function setColumnWidth(
  columns: readonly ColumnState[],
  id: ColumnId,
  width: number
): ColumnState[]
{
  if (!isResizable(id))
  {
    return [...columns];
  }
  return columns.map((c) =>
  {
    if (c.id === id)
    {
      return { ...c, width: clamp(width) };
    }
    else
    {
      return c;
    }
  });
}

/** Hand a column back to its content: what double-clicking its edge does. */
export function autoColumnWidth(columns: readonly ColumnState[], id: ColumnId): ColumnState[]
{
  if (!isResizable(id))
  {
    return [...columns];
  }
  return columns.map((c) =>
  {
    if (c.id === id)
    {
      return { ...c, width: null };
    }
    else
    {
      return c;
    }
  });
}

export function setColumnVisible(
  columns: readonly ColumnState[],
  id: ColumnId,
  visible: boolean
): ColumnState[]
{
  if (!visible && !isHideable(id))
  {
    return [...columns];
  }
  return columns.map((c) =>
  {
    if (c.id === id)
    {
      return { ...c, visible };
    }
    else
    {
      return c;
    }
  });
}

/**
 * Move `id` so it lands immediately before `before`, or last when `before` is null.
 * Returns the list unchanged rather than throwing: an illegal drag puts the column back, not fails.
 */
export function moveColumn(
  columns: readonly ColumnState[],
  id: ColumnId,
  before: ColumnId | null
): ColumnState[]
{
  if (!isMovable(id) || id === before)
  {
    return [...columns];
  }
  if (before !== null && !isMovable(before))
  {
    return [...columns];
  }

  const moving = columns.find((c) => c.id === id);
  if (!moving)
  {
    return [...columns];
  }

  const rest = columns.filter((c) => c.id !== id);
  let at;
  if (before === null)
  {
    at = rest.length;
  }
  else
  {
    at = rest.findIndex((c) => c.id === before);
  }
  if (at === -1)
  {
    return [...columns];
  }

  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** What the content of each auto-sized column measures, in pixels. */
export type MeasuredWidths = Partial<Record<ColumnId, number>>;

/**
 * The `grid-template-columns` value for the current layout. `graph` is `gutter`, its
 * measured lane count; `message` is `1fr` with a stored width as a floor, not a size;
 * the rest are their measured content width until dragged.
 *
 * `measured` comes from the grid, the only place that knows what the cells currently
 * say. A column missing from it (an unloaded repository) falls back to the minimum, not zero, so the header still reads.
 */
export function gridTemplate(
  columns: readonly ColumnState[],
  gutter: number,
  measured: MeasuredWidths = {}
): string
{
  return visibleColumns(columns)
    .map((c) =>
    {
      if (c.id === COLUMN_GRAPH)
      {
        return `${gutter}px`;
      }
      if (c.id === COLUMN_MESSAGE)
      {
        return `minmax(${c.width ?? 0}px, 1fr)`;
      }
      return `${c.width ?? measured[c.id] ?? MIN_COLUMN_WIDTH}px`;
    })
    .join(' ');
}
