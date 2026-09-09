/**
 * What GraphCanvas needs: selected rows, rows with refs, line width, head row.
 * Separate from interaction and virtualization.
 */

import { computed } from 'vue';
import type { CommitRow } from '@shared/types.js';
import { refsAtHead } from '@renderer/model/refsAtHead.js';
import { LANE_LINE_WIDTHS } from './geometry.js';

export interface GraphPropsOptions {
  range: () => { start: number; end: number };
  rows: () => readonly CommitRow[];
  isSelected: (sha: string) => boolean;
  selectionCount: () => number;
  head: () => string | null | undefined;
  /** Short name of the checked-out branch; null or undefined on a detached HEAD. */
  branch: () => string | null | undefined;
  rowOf: (sha: string) => number | undefined;
  lineWidth: () => keyof typeof LANE_LINE_WIDTHS;
}

export function useGraphProps(opts: GraphPropsOptions)
{
  /**
   * Selected rows (translated from SHA, visible range only to avoid thousands).
   */
  const selectedRows = computed(() =>
  {
    const rows = new Set<number>();
    if (opts.selectionCount() === 0)
    {
      return rows;
    }
    const { start, end } = opts.range();
    const source = opts.rows();
    for (let i = start; i < end; i++)
    {
      const commit = source[i];
      if (commit && opts.isSelected(commit.sha))
      {
        rows.add(i);
      }
    }
    return rows;
  });

  /**
   * Rows drawn as square (carry branch/tag/ref). Visible range only.
   * Use refsAtHead (not commit.refs) so square marks exactly match chips.
   */
  const rowsWithRefs = computed(() =>
  {
    const rows = new Set<number>();
    const { start, end } = opts.range();
    const source = opts.rows();
    const branch = opts.branch() ?? null;
    for (let i = start; i < end; i++)
    {
      const commit = source[i];
      if (commit && refsAtHead(commit.refs, branch).length > 0)
      {
        rows.add(i);
      }
    }
    return rows;
  });

  /**
   * Line width resolved to pixels. Rendering, not layout: it never reaches `buildGraph`.
   */
  const graphLineWidth = computed(() => LANE_LINE_WIDTHS[opts.lineWidth()]);

  /**
   * Row the canvas rings as checked-out, or -1 (detached/unborn HEAD or off-screen).
   */
  const headRow = computed(() =>
  {
    const head = opts.head();
    if (head)
    {
      return opts.rowOf(head) ?? -1;
    }
    else
    {
      return -1;
    }
  });

  return { selectedRows, rowsWithRefs, graphLineWidth, headRow };
}
