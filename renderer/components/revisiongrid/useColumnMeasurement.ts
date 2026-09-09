/**
 * Measure auto-sized column width from on-screen content.
 * Extracted for independent reason to change (measurement vs. resize/reorder/persist).
 */

import { ref } from 'vue';
import type { Ref } from 'vue';
import type { CommitRow, DateFormat } from '@shared/types.js';
import { isArtificialSha } from '@shared/artificial.js';
import {
  COLUMN_AUTHOR,
  COLUMN_DATE,
  COLUMN_LABELS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type MeasuredWidths
} from '@renderer/columns.js';
import { styleOf, textWidth } from '@renderer/measure.js';
import { formatAuthorName, formatCommitDate, gridCommitDate, shortSha } from '@renderer/format.js';

/** The columns whose width is their text. `graph` is lanes, `message` is `1fr`. */
const MEASURED_COLUMNS = ['author', 'date', 'sha'] as const;
type MeasuredColumn = (typeof MEASURED_COLUMNS)[number];

/** The resize handle overlays the right edge of the header, so the label stops short. */
const HANDLE_WIDTH = 8;
/** Subpixel slack, so a width rounded down does not ellipsise the string it just fit. */
const SLACK = 2;

export interface ColumnMeasurementOptions {
  authorInitials: () => boolean;
  dateFormat: () => DateFormat;
  showAuthorDate: () => boolean;
  /** Rows currently rendered, indexed like `range`. */
  rows: () => readonly CommitRow[];
  /** First and last index the canvas (and the measurer) has to look at. */
  range: () => { start: number; end: number };
  headerEl: Ref<HTMLElement | null>;
  probeEl: Ref<HTMLElement | null>;
}

export function useColumnMeasurement(opts: ColumnMeasurementOptions)
{
  /**
   * What the author, date and SHA columns measure, for the ones nobody has dragged.
   *
   * Measured from the rows on screen, the way the graph gutter is measured from the lanes
   * on screen: the alternative is walking a hundred thousand commits to find the one
   * name that would make the column permanently too wide. Scrolling can widen a column
   * and never narrows one: a column that resized under the pointer while you read down it
   * would be worse than one that is a few pixels too wide. Double-clicking the edge
   * starts the measurement again from what is showing now.
   */
  const measured = ref<MeasuredWidths>({});

  function cellText(id: MeasuredColumn, row: CommitRow): string
  {
    if (isArtificialSha(row.sha))
    {
      return ':';
    }
    switch (id)
    {
      case COLUMN_AUTHOR:
        return formatAuthorName(row.authorName, row.authorEmail, opts.authorInitials());
      case COLUMN_DATE:
        return formatCommitDate(gridCommitDate(row, opts.showAuthorDate()), opts.dateFormat());
      default:
        return shortSha(row.sha);
    }
  }

  /**
   * `fresh` throws the previous measurements away instead of taking the wider of the two
   *: for a different repository, a setting that changes what a cell says, or a
   * double-click asking for a refit.
   */
  function remeasure(fresh = false): void
  {
    const label = opts.headerEl.value?.querySelector('.head-label');
    if (!opts.probeEl.value || !label)
    {
      return;
    }

    const labelStyle = styleOf(label);
    let next: MeasuredWidths;
    if (fresh)
    {
      next = {};
    }
    else
    {
      next = { ...measured.value };
    }
    let changed = fresh;
    const { start, end } = opts.range();
    const rows = opts.rows();

    for (const id of MEASURED_COLUMNS)
    {
      const cell = opts.probeEl.value.querySelector(`.col-${id}`);
      if (!cell)
      {
        continue;
      }
      const style = styleOf(cell);

      // The header is content too: a column narrower than its own name reads as broken.
      let widest = textWidth(COLUMN_LABELS[id], labelStyle) + HANDLE_WIDTH;
      for (let i = start; i < end; i++)
      {
        const row = rows[i];
        if (row)
        {
          widest = Math.max(widest, textWidth(cellText(id, row), style));
        }
      }

      const width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(widest) + SLACK));
      if (width > (next[id] ?? 0))
      {
        next[id] = width;
        changed = true;
      }
    }

    if (changed)
    {
      measured.value = next;
    }
  }

  return { measured, remeasure };
}
