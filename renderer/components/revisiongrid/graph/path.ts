/**
 * The shapes a line can take inside one row: straight down its column, across to
 * another column, out of the node into a column, or out of a column into the node.
 *
 * Every column change is drawn as one diagonal, never as a jog, and every one of them
 * meets the row's edge travelling **vertically**, parallel to the column it is joining.
 * That is what lets the row above and the row below be drawn with no knowledge of each
 * other and still join invisibly, and it is why the canvas needs no clipping.
 */

/** How far along the straight diagonal the curve holds before it bends to vertical. */
const DIAGONAL_HOLD = 0.5;

/** How much of the available height the vertical approach into a column takes. */
const VERTICAL_APPROACH = 0.35;

export function strokeVertical(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number
): void
{
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
}

/** Down one column and across to another, vertical at both edges of the row. */
export function strokeAcross(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  top: number,
  toX: number,
  bottom: number
): void
{
  if (fromX === toX)
  {
    strokeVertical(ctx, fromX, top, bottom);
    return;
  }

  const height = bottom - top;
  ctx.beginPath();
  ctx.moveTo(fromX, top);
  ctx.bezierCurveTo(
    fromX,
    top + height * VERTICAL_APPROACH,
    toX,
    bottom - height * VERTICAL_APPROACH,
    toX,
    bottom
  );
  ctx.stroke();
}

/** From the node, out to the column the line will hold, arriving vertically. */
export function strokeOutOfNode(
  ctx: CanvasRenderingContext2D,
  nodeX: number,
  nodeY: number,
  laneX: number,
  bottom: number
): void
{
  if (nodeX === laneX)
  {
    strokeVertical(ctx, nodeX, nodeY, bottom);
    return;
  }

  const dx = laneX - nodeX;
  const dy = bottom - nodeY;
  ctx.beginPath();
  ctx.moveTo(nodeX, nodeY);
  ctx.bezierCurveTo(
    nodeX + dx * DIAGONAL_HOLD,
    nodeY + dy * DIAGONAL_HOLD,
    laneX,
    bottom - dy * VERTICAL_APPROACH,
    laneX,
    bottom
  );
  ctx.stroke();
}

/** From the column the line has been holding, in to the node, leaving vertically. */
export function strokeIntoNode(
  ctx: CanvasRenderingContext2D,
  laneX: number,
  top: number,
  nodeX: number,
  nodeY: number
): void
{
  if (nodeX === laneX)
  {
    strokeVertical(ctx, nodeX, top, nodeY);
    return;
  }

  const dx = nodeX - laneX;
  const dy = nodeY - top;
  ctx.beginPath();
  ctx.moveTo(laneX, top);
  ctx.bezierCurveTo(
    laneX,
    top + dy * VERTICAL_APPROACH,
    nodeX - dx * DIAGONAL_HOLD,
    nodeY - dy * DIAGONAL_HOLD,
    nodeX,
    nodeY
  );
  ctx.stroke();
}
