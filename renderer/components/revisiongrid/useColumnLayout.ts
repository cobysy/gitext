/**
 * The revision grid's column layout: widths, drag-resize, drag-reorder, and the
 * auto-measured widths of columns nobody has dragged. Pulled out of `RevisionGrid.vue`:
 * how wide a column is and where it sits is independent of virtualization or selection.
 * What an unpinned column's content measures to lives in `useColumnMeasurement.ts`.
 */

import { computed, ref, type Ref } from 'vue';
import type { CommitRow, DateFormat } from '@shared/types.js';
import {
  COLUMN_GRAPH,
  MIN_COLUMN_WIDTH,
  autoColumnWidth,
  gridTemplate,
  isMovable,
  isResizable,
  moveColumn,
  normalizeColumns,
  setColumnWidth,
  visibleColumns,
  type ColumnId,
  type ColumnState
} from '@renderer/columns.js';
import { gutterWidth as gutterWidthForLanes } from './geometry.js';
import { useColumnMeasurement } from './useColumnMeasurement.js';

export interface ColumnLayoutOptions {
  /** Unreconciled settings storage: `normalizeColumns` is what gives it shape. */
  gridColumns: () => unknown;
  persist: (next: ColumnState[]) => void;
  authorInitials: () => boolean;
  dateFormat: () => DateFormat;
  showAuthorDate: () => boolean;
  /** Rows currently rendered, indexed like `range`. */
  rows: () => readonly CommitRow[];
  /** First and last index the canvas (and the measurer) has to look at. */
  range: () => { start: number; end: number };
  /** Widest lane count among the rendered rows, for the graph gutter. */
  widestLaneCount: () => number;
  headerEl: Ref<HTMLElement | null>;
  probeEl: Ref<HTMLElement | null>;
}

export function useColumnLayout(opts: ColumnLayoutOptions)
{
  /** The column layout in force. `drag` holds it mid-resize: settings are written on pointer-up, not every pointer-move, so a drag is one config write. */
  const drag = ref<ColumnState[] | null>(null);
  const columns = computed<ColumnState[]>(() => drag.value ?? normalizeColumns(opts.gridColumns()));
  const shownColumns = computed(() => visibleColumns(columns.value));
  const graphVisible = computed(() => shownColumns.value.some((c) => c.id === COLUMN_GRAPH));

  /** Width the graph gutter is currently taking, so the columns line up beside it. */
  const gutterWidth = computed(() =>
  {
    if (graphVisible.value)
    {
      return gutterWidthForLanes(opts.widestLaneCount());
    }
    else
    {
      return 0;
    }
  });

  const { measured, remeasure } = useColumnMeasurement({
    authorInitials: opts.authorInitials,
    dateFormat: opts.dateFormat,
    showAuthorDate: opts.showAuthorDate,
    rows: opts.rows,
    range: opts.range,
    headerEl: opts.headerEl,
    probeEl: opts.probeEl
  });

  /** One template for the header and every row: see `columns.ts`. */
  const template = computed(() => gridTemplate(columns.value, gutterWidth.value, measured.value));

  function persistColumns(next: ColumnState[]): void
  {
    opts.persist(next);
  }

  // ── Resizing ─────────────────────────────────────────────────────────────────

  /** Drag a column edge. Pointer capture, not document listeners: the pointer leaves the 5px handle on the first move of any real drag. */
  function onResizeStart(id: ColumnId, event: PointerEvent): void
  {
    if (!isResizable(id))
    {
      return;
    }
    const startX = event.clientX;
    const handle = event.currentTarget as HTMLElement;
    const header = handle.parentElement;
    // Measured off the header, not read out of the column state: a column that has never been dragged has no width there, only whatever its content or `1fr` came to.
    const startWidth = header?.getBoundingClientRect().width ?? MIN_COLUMN_WIDTH;

    // The handle sits inside a `draggable` header, and pressing a draggable element starts
    // a native drag on the first pointer move. Cleared here, not through a reactive
    // binding, since it must be gone before the browser's drag threshold, sooner than the next render.
    header?.setAttribute('draggable', 'false');

    drag.value = [...columns.value];
    handle.setPointerCapture(event.pointerId);

    // A press that never moved is not a resize: without this, a double-click's two clicks would each pin the column on the way to asking it to stop being pinned.
    let moved = false;

    const onMove = (move: PointerEvent): void =>
    {
      moved = true;
      drag.value = setColumnWidth(columns.value, id, startWidth + (move.clientX - startX));
    };

    const onEnd = (): void =>
    {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      // Vue owns this attribute again from the next render; restoring it keeps the header draggable in the meantime.
      if (isMovable(id))
      {
        header?.setAttribute('draggable', 'true');
      }
      const settled = drag.value;
      drag.value = null;
      if (settled && moved)
      {
        persistColumns(settled);
      }
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
    event.preventDefault();
  }

  /** Double-clicking an edge gives the column back to its content. Refits every auto column, not only this one: the gesture means "fit what is on screen". */
  function onResizeReset(id: ColumnId): void
  {
    if (!isResizable(id))
    {
      return;
    }
    persistColumns(autoColumnWidth(columns.value, id));
    remeasure(true);
  }

  // ── Reordering ───────────────────────────────────────────────────────────────

  const dragging = ref<ColumnId | null>(null);
  /** The column the dragged one would land in front of; null means "to the end". */
  const dropBefore = ref<ColumnId | null | undefined>(undefined);

  function onHeaderDragStart(id: ColumnId, event: DragEvent): void
  {
    if (!isMovable(id))
    {
      event.preventDefault();
      return;
    }
    dragging.value = id;
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer)
    {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  /** Which side of the hovered header the drop lands on: past the midpoint means "before whatever comes next", keeping `moveColumn` free of a before/after flag. */
  function onHeaderDragOver(id: ColumnId, event: DragEvent): void
  {
    if (dragging.value === null || !isMovable(id))
    {
      return;
    }
    event.preventDefault();

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    if (!after)
    {
      dropBefore.value = id;
      return;
    }

    const order = shownColumns.value;
    const next = order[order.findIndex((c) => c.id === id) + 1];
    dropBefore.value = next?.id ?? null;
  }

  function onHeaderDrop(): void
  {
    const moving = dragging.value;
    if (moving !== null && dropBefore.value !== undefined)
    {
      persistColumns(moveColumn(columns.value, moving, dropBefore.value));
    }
    onHeaderDragEnd();
  }

  function onHeaderDragEnd(): void
  {
    dragging.value = null;
    dropBefore.value = undefined;
  }

  return {
    columns,
    shownColumns,
    graphVisible,
    gutterWidth,
    template,
    measured,
    remeasure,
    persistColumns,
    dragging,
    dropBefore,
    onResizeStart,
    onResizeReset,
    onHeaderDragStart,
    onHeaderDragOver,
    onHeaderDrop,
    onHeaderDragEnd
  };
}
