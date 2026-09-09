/**
 * Turn a line that arrives at its commit from several columns away into a diagonal.
 *
 * The layout keeps the gutter packed, so a line ending at a node three columns to its
 * left has to get there somehow, and inside one row that is a five-degree line: it reads
 * as horizontal, not as a lane change. Moving the line's *column* earlier would mean
 * shoving its neighbours aside and letting them drift back, and a gutter full of lines
 * stepping out of the way and returning reads as ribbons rather than lanes.
 *
 * So this moves where the line is **drawn**, not where it lives: over the rows above the
 * node it slides one column per row, crossing over its neighbours rather than displacing
 * them. Two lines briefly sharing a column is what a crossing looks like, and it costs
 * nothing, where a displacement costs every line beside it.
 *
 * It only ever touches rows where the line runs straight down a single column, and it
 * closes back onto that column at the top, so the result still joins the row above
 * exactly.
 */

import type { GraphLine, GraphRow } from './types.js';

/** Where one line was drawn, row by row, in the order the rows were built. */
export interface LineTrack {
  row: number;
  line: GraphLine;
}

export function slantArrivals(rows: readonly GraphRow[], tracks: Iterable<LineTrack[]>): void
{
  for (const track of tracks)
  {
    slantOne(rows, track);
  }
}

function slantOne(rows: readonly GraphRow[], track: readonly LineTrack[]): void
{
  const last = track[track.length - 1];
  if (!last || last.line.toLane >= 0)
  {
    return;
  }

  const column = last.line.fromLane;
  const node = rows[last.row]!.nodeLane;
  const distance = column - node;
  if (distance <= 1)
  {
    return;
  }

  const usable = straightRowsAbove(track, column, distance - 1);
  if (usable === 0)
  {
    return;
  }

  // The arrival itself becomes a one-column diagonal, and each row above hands it one
  // column further right, until the topmost one closes back onto the line's own column.
  last.line.fromLane = node + 1;
  let handOver = node + 1;
  for (let step = 1; step <= usable; step++)
  {
    const above = track[track.length - 1 - step]!.line;
    above.toLane = handOver;
    handOver++;
    if (step === usable)
    {
      above.fromLane = column;
    }
    else
    {
      above.fromLane = handOver;
    }
  }
}

/**
 * How many rows immediately above the arrival draw the line as a plain vertical in its
 * own column, up to `wanted`. A row where it was already moving is where this stops: its
 * shape is somebody else's answer and overwriting it would break the join.
 */
function straightRowsAbove(track: readonly LineTrack[], column: number, wanted: number): number
{
  let usable = 0;
  while (usable < wanted)
  {
    const entry = track[track.length - 2 - usable];
    if (!entry || entry.row !== track[track.length - 1]!.row - usable - 1)
    {
      break;
    }
    if (entry.line.fromLane !== column || entry.line.toLane !== column)
    {
      break;
    }
    usable++;
  }
  return usable;
}
