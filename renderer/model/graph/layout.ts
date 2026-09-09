/**
 * Commits in, rows of lanes out. Pure: no git, no DOM, no Vue.
 *
 * One forward pass, no second visit and nothing to straighten afterwards. Every column a
 * line occupies is decided in the row it moves in, and `OpenLines` lets it move by at
 * most one column per row, so a lane change is always a diagonal and never a jog.
 *
 * **Order is a precondition.** `commits` must be in display order, as `git log` emits
 * it, parents after children. A parent outside the loaded set is simply never reached:
 * its column stays open to the end and the line runs off the bottom of the list, which
 * is the honest drawing of "the rest is not loaded yet".
 */

import type { GraphConfig } from './config.js';
import { OpenLines, type OpenLine } from './lanes.js';
import { hashSha, NO_COLOR, pickColor, veto, vetoesEverything } from './palette.js';
import { slantArrivals, type LineTrack } from './slant.js';
import type { GraphInputCommit, GraphLine, GraphRow } from './types.js';

export function buildGraph(
  commits: readonly GraphInputCommit[],
  config: GraphConfig
): GraphRow[]
{
  const open = new OpenLines();
  const rows: GraphRow[] = [];
  // Where each line was drawn, row by row: `slantArrivals` needs to reach back over the
  // rows above a node to turn a long arrival into a diagonal.
  const tracks = new Map<OpenLine, LineTrack[]>();

  for (let row = 0; row < commits.length; row++)
  {
    rows.push(layOutRow(commits[row]!, row, open, config, tracks));
  }

  slantArrivals(rows, tracks.values());
  return rows;
}

/** Note that `line` is how `of` is drawn in `row`, for the slanting pass to find later. */
function track(
  tracks: Map<OpenLine, LineTrack[]>,
  of: OpenLine,
  row: number,
  line: GraphLine
): void
{
  const existing = tracks.get(of);
  if (existing)
  {
    existing.push({ row, line });
  }
  else
  {
    tracks.set(of, [{ row, line }]);
  }
}

/** A line the row is drawing, before the column it leaves the row in is known. */
interface PendingLine {
  fromLane: number;
  /** The open line whose column this one leaves the row in. */
  leavesWith: OpenLine;
  color: number;
  childRow: number;
}

function layOutRow(
  commit: GraphInputCommit,
  row: number,
  open: OpenLines,
  config: GraphConfig,
  tracks: Map<OpenLine, LineTrack[]>
): GraphRow
{
  const top = open.columns();
  const lines: GraphLine[] = [];
  const pending: PendingLine[] = [];

  // The lines arriving here end here. The leftmost is where the node goes, and its
  // colour is the one the commit carries on with: a branch is one line in one colour
  // until something ends it.
  const { nodeColumn, ended } = open.end(commit.sha);
  let incomingColor = NO_COLOR;
  for (const line of ended)
  {
    if (incomingColor === NO_COLOR)
    {
      incomingColor = line.color;
    }
    const arriving: GraphLine = {
      fromLane: top.get(line)!,
      toLane: -1,
      color: line.color,
      childRow: line.childRow
    };
    lines.push(arriving);
    track(tracks, line, row, arriving);
  }

  for (const [line, column] of top)
  {
    if (!ended.includes(line))
    {
      pending.push({ fromLane: column, leavesWith: line, color: line.color, childRow: line.childRow });
    }
  }

  // Nothing arrives: a branch tip, or the first row. It takes the leftmost column going
  // spare, which is how a gap left by something that ended gets used rather than kept.
  let nodeLane = nodeColumn;
  if (nodeLane < 0)
  {
    nodeLane = open.firstFreeColumn();
  }

  const started: OpenLine[] = [];
  // The node is the colour of the line running through it: whatever arrived, or, at a
  // branch tip where nothing did, the line it starts downward. Never a line that merely
  // crosses the row, which is why this is read off the commit's own first parent.
  let color = incomingColor;
  for (let index = 0; index < commit.parents.length; index++)
  {
    const line = startParent(commit, index, {
      row,
      nodeLane,
      incomingColor,
      open,
      started,
      config
    });
    pending.push(line);
    if (color === NO_COLOR)
    {
      color = line.color;
    }
  }

  if (color === NO_COLOR)
  {
    // Neither children nor parents in the loaded set: commonest under a filter.
    color = pickColor(hashSha(commit.sha), 0);
  }

  open.start(nodeLane, started);
  open.settle();
  open.trim();
  const bottom = open.columns();

  for (const line of pending)
  {
    const drawn: GraphLine = {
      fromLane: line.fromLane,
      toLane: bottom.get(line.leavesWith) ?? -1,
      color: line.color,
      childRow: line.childRow
    };
    lines.push(drawn);
    track(tracks, line.leavesWith, row, drawn);
  }

  return { nodeLane, color, laneCount: laneCountFor(nodeLane, lines), lines };
}

/** What starting one of a commit's parent lines needs to know. */
interface StartContext {
  row: number;
  nodeLane: number;
  /** Colour of the line arriving at this commit, or `NO_COLOR` when nothing arrives. */
  incomingColor: number;
  open: OpenLines;
  /** Lines this commit has already started, which a later parent may join. */
  started: OpenLine[];
  config: GraphConfig;
}

/**
 * Start the line from this commit to one of its parents. It leaves the node as a
 * diagonal into whichever column it will hold.
 */
function startParent(commit: GraphInputCommit, index: number, context: StartContext): PendingLine
{
  const { row, incomingColor, open, started, config } = context;
  const parent = commit.parents[index]!;

  // The first parent of a commit something arrived at is that same line carrying on:
  // it keeps the colour it already had.
  const carriesOn = index === 0 && incomingColor !== NO_COLOR;

  // A line that starts here may join a column already heading for the same commit.
  // Never a line that carries a commit onward: that one is the commit's own history
  // continuing, and pulling it sideways would walk the mainline about every time a
  // branch happened to reach the same place first. Those two converge at the parent
  // instead, meeting where the gutter closes up behind whichever ends first.
  if (config.mergeCommonParentLanes && !carriesOn)
  {
    const shared = started.find((line) => line.target === parent) ?? open.find(parent);
    if (shared)
    {
      // Drawn in the colour of the column it joins, because from the join downward it
      // *is* that line. Its own colour would put a stub of a second colour under the
      // node and stop dead at the row's edge.
      return { fromLane: -1, leavesWith: shared, color: shared.color, childRow: row };
    }
  }

  let color: number;
  if (carriesOn)
  {
    color = incomingColor;
  }
  else
  {
    color = newColor(parent, context);
  }

  const line: OpenLine = { target: parent, color, childRow: row };
  started.push(line);
  return { fromLane: -1, leavesWith: line, color, childRow: row };
}

/**
 * A colour for a line starting here: seeded from the commit it heads for, then stepped
 * clear of **every colour currently on screen**, so no two lines in the gutter at once
 * are the same and the eye can follow one down without counting columns. A gutter wider
 * than the palette cannot manage that, and then the veto falls back to what actually
 * matters: the line it branched off, so a branch never leaves its parent in the parent's
 * own colour.
 */
function newColor(parent: string, context: StartContext): number
{
  const seed = hashSha(parent);

  let everything = veto(context.open.vetoMask(), context.incomingColor);
  for (const line of context.started)
  {
    everything = veto(everything, line.color);
  }
  if (!vetoesEverything(everything))
  {
    return pickColor(seed, everything);
  }

  return pickColor(seed, veto(0, context.incomingColor));
}

/** How wide the gutter has to be for this row: the rightmost column anything touches. */
function laneCountFor(nodeLane: number, lines: readonly GraphLine[]): number
{
  let count = nodeLane + 1;
  for (const line of lines)
  {
    count = Math.max(count, line.fromLane + 1, line.toLane + 1);
  }
  return count;
}
