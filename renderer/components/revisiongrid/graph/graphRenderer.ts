/**
 * One row of the gutter, painted.
 *
 * A row is self-contained: `GraphRow` already says which column every line is in at the
 * top edge, at the node, and at the bottom edge, so nothing here reads a neighbouring
 * row and nothing is painted twice. Lines first, node last, and while a highlight is
 * active the dimmed lines go down before the lit ones so a lit line is never painted
 * over by a dim one.
 */

import type { GraphLine, GraphRow } from '@renderer/model/graph/index.js';
import { markRelative } from '@renderer/model/graph/index.js';
import { laneX, MAX_LANES, NODE_DIMENSION } from '../geometry.js';
import { strokeAcross, strokeIntoNode, strokeOutOfNode, strokeVertical } from './path.js';

/** Everything a row needs to draw itself that is the same for every row on the canvas. */
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  rowHeight: number;
  /** Stroke width of a lane line, in CSS pixels. */
  lineWidth: number;

  /** `--graph-0` … `--graph-6`, resolved once per draw. */
  colors: readonly string[];
  /** `--graph-dim`, for anything outside the highlighted ancestry. */
  dimColor: string;
  /** `--bg`, the fill of an unselected node's centre. */
  background: string;
  /** `--fg`, the ring around the checked-out commit. */
  foreground: string;

  /**
   * The ancestry marks. Zero-length means nothing is highlighted, and then nothing
   * dims: `markRelative` reads it that way, so there is no second flag to keep in step.
   */
  relative: Uint8Array;
  isSelected: (index: number) => boolean;
  /** Commits carrying a ref draw as a square rather than a circle. */
  hasRefs: (index: number) => boolean;
  /** Row holding the checked-out commit, or -1. */
  head: number;
}

export function drawRow(row: GraphRow, index: number, top: number, context: DrawContext): void
{
  const { ctx } = context;
  ctx.lineWidth = context.lineWidth;
  // Round rather than the default flat caps and miter joins: a miter exaggerates a bend
  // into a spike, and a round cap stops a line that ends mid-row reading as clipped.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (context.relative.length > 0)
  {
    drawLines(row, top, context, true);
    drawLines(row, top, context, false);
  }
  else
  {
    drawLines(row, top, context, false);
  }

  drawNode(row, index, top, context);
}

/** The row's lines, either the dimmed ones or the lit ones. */
function drawLines(row: GraphRow, top: number, context: DrawContext, dimmed: boolean): void
{
  const { ctx } = context;
  for (const line of row.lines)
  {
    if (isDimmed(line, context) !== dimmed)
    {
      continue;
    }
    if (!fits(line, row))
    {
      continue;
    }

    if (dimmed)
    {
      ctx.strokeStyle = context.dimColor;
    }
    else
    {
      ctx.strokeStyle = context.colors[line.color % context.colors.length] ?? context.dimColor;
    }
    strokeLine(line, row, top, context);
  }
}

function strokeLine(line: GraphLine, row: GraphRow, top: number, context: DrawContext): void
{
  const { ctx, rowHeight } = context;
  const centerY = top + rowHeight / 2;
  const bottom = top + rowHeight;

  if (line.fromLane < 0)
  {
    strokeOutOfNode(ctx, laneX(row.nodeLane), centerY, laneX(line.toLane), bottom);
  }
  else if (line.toLane < 0)
  {
    strokeIntoNode(ctx, laneX(line.fromLane), top, laneX(row.nodeLane), centerY);
  }
  else if (line.fromLane === line.toLane)
  {
    strokeVertical(ctx, laneX(line.fromLane), top, bottom);
  }
  else
  {
    strokeAcross(ctx, laneX(line.fromLane), top, laneX(line.toLane), bottom);
  }
}

/**
 * Whether a line is inside the widest gutter the graph may occupy. A line with either
 * end past the cap is dropped rather than stacked into the last column: a stacked line
 * paints over the branch that genuinely owns that column, which reads as a colouring
 * fault rather than the missing room it is.
 */
function fits(line: GraphLine, row: GraphRow): boolean
{
  return line.fromLane < MAX_LANES && line.toLane < MAX_LANES && row.nodeLane < MAX_LANES;
}

function isDimmed(line: GraphLine, context: DrawContext): boolean
{
  return !markRelative(context.relative, line.childRow);
}

/**
 * The node. Square when the commit carries a ref, so shape says "there is a name here";
 * filled when the row is selected, so fill says "you picked this"; and a ring outside
 * either of those for the checked-out commit.
 */
function drawNode(row: GraphRow, index: number, top: number, context: DrawContext): void
{
  if (row.nodeLane >= MAX_LANES)
  {
    return;
  }

  const { ctx } = context;
  const centerX = laneX(row.nodeLane);
  const centerY = top + context.rowHeight / 2;
  const radius = NODE_DIMENSION / 2;

  let color: string;
  if (markRelative(context.relative, index))
  {
    color = context.colors[row.color % context.colors.length] ?? context.dimColor;
  }
  else
  {
    color = context.dimColor;
  }

  const path = (r: number): void =>
  {
    ctx.beginPath();
    if (context.hasRefs(index))
    {
      ctx.rect(centerX - r, centerY - r, r * 2, r * 2);
    }
    else
    {
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
    }
  };

  ctx.lineWidth = context.lineWidth;
  path(radius);
  if (context.isSelected(index))
  {
    ctx.fillStyle = color;
  }
  else
  {
    ctx.fillStyle = context.background;
  }
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();

  if (index === context.head)
  {
    path(radius + 2);
    ctx.strokeStyle = context.foreground;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.lineWidth = context.lineWidth;
  }
}
