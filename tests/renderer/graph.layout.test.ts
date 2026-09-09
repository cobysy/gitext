/**
 * The layout, as a picture.
 *
 * Lane indices in an array are unreadable, so every shape assertion here goes through
 * `ascii`, which draws the laid-out rows the way `git log --graph` draws its own: a node
 * line per commit and an edge line between two of them. A regression then shows up as a
 * one-line diff rather than as an argument about index 3.
 *
 * Two invariants most of these exist to protect, because between them they are every
 * staircase, jog and drifting mainline the graph can grow:
 *
 * - a line moves **left only**, and only in the row where the lines beside it ended;
 * - the gutter never holds an empty column with lines to either side of it.
 */

import { describe, expect, it } from 'vitest';
import { buildGraph } from '@renderer/model/graph/layout.js';
import { DEFAULT_GRAPH_CONFIG } from '@renderer/model/graph/config.js';
import type { GraphInputCommit, GraphRow } from '@renderer/model/graph/types.js';

/** `"sha: parent parent"`, so a test reads as the topology it describes. */
function commits(...spec: string[]): GraphInputCommit[]
{
  return spec.map((line) =>
  {
    const [sha, rest] = line.split(':');
    return { sha: sha!.trim(), parents: (rest ?? '').trim().split(/\s+/).filter(Boolean) };
  });
}

function layout(spec: string[], mergeCommonParentLanes = true): GraphRow[]
{
  return buildGraph(commits(...spec), { mergeCommonParentLanes });
}

/**
 * Draw the rows the way `git log --graph` does: a node line per commit, an edge line
 * between two of them, one column every two characters so a diagonal has a gap to lean
 * through. `*` is a node, `|` a line going straight down its column, and `\` or `/` a
 * line leaning into the column beside it, which is the whole of what a lane change is.
 */
function ascii(rows: readonly GraphRow[]): string
{
  const width = Math.max(...rows.map((row) => row.laneCount)) * 2;
  const out: string[] = [];

  for (let index = 0; index < rows.length; index++)
  {
    const row = rows[index]!;
    const line = new Array<string>(width).fill(' ');
    for (const link of row.lines)
    {
      if (link.fromLane >= 0 && link.toLane >= 0)
      {
        line[link.fromLane * 2] = '|';
      }
    }
    line[row.nodeLane * 2] = '*';
    out.push(line.join('').trimEnd());

    if (index < rows.length - 1)
    {
      out.push(edgeLine(row, rows[index + 1]!, width));
    }
  }

  return out.join('\n');
}

/** The strip between two rows: where each line is as it crosses. */
function edgeLine(row: GraphRow, next: GraphRow, width: number): string
{
  const line = new Array<string>(width).fill(' ');

  // Lines ending at the next row's node, drawn from the column they have been holding.
  for (const link of next.lines)
  {
    if (link.fromLane >= 0 && link.toLane < 0)
    {
      mark(line, link.fromLane, next.nodeLane);
    }
  }
  // Lines crossing the edge: down their own column, across to another, or leaning out
  // of this row's node into the column they will hold.
  for (const link of row.lines)
  {
    if (link.toLane < 0)
    {
      continue;
    }
    if (link.fromLane >= 0)
    {
      mark(line, link.fromLane, link.toLane);
    }
    else
    {
      mark(line, row.nodeLane, link.toLane);
    }
  }

  return line.join('').trimEnd();
}

/**
 * A line running from column `from` to column `to` across one edge: straight down its
 * own column, or a slant in the gap beside the column it is heading for.
 */
function mark(line: string[], from: number, to: number): void
{
  if (to === from)
  {
    line[to * 2] = '|';
  }
  else if (to > from)
  {
    line[to * 2 - 1] = '\\';
  }
  else
  {
    line[to * 2 + 1] = '/';
  }
}

/**
 * A commit that just carries one line on moves nothing: the column its line vacates is
 * the column its line takes. The one thing that may still shift in such a row is a line
 * being drawn diagonally across it toward a node below, and that steps one column.
 */
function expectQuietRowsStayQuiet(rows: readonly GraphRow[]): void
{
  for (const row of rows)
  {
    const ends = row.lines.filter((line) => line.toLane < 0).length;
    const starts = row.lines.filter((line) => line.fromLane < 0).length;
    if (ends !== starts)
    {
      continue;
    }
    for (const line of row.lines)
    {
      if (line.fromLane >= 0 && line.toLane >= 0)
      {
        expect(Math.abs(line.toLane - line.fromLane)).toBeLessThanOrEqual(1);
      }
    }
  }
}

/** Which columns a row has something in, at either edge or at the node. */
function occupied(row: GraphRow): Set<number>
{
  const columns = new Set<number>([row.nodeLane]);
  for (const line of row.lines)
  {
    for (const lane of [line.fromLane, line.toLane])
    {
      if (lane >= 0)
      {
        columns.add(lane);
      }
    }
  }
  return columns;
}

/** No empty column anywhere in the gutter: true only where nothing is mid-move. */
function expectNoGaps(rows: readonly GraphRow[]): void
{
  for (const row of rows)
  {
    for (let lane = 0; lane < row.laneCount; lane++)
    {
      expect(occupied(row).has(lane)).toBe(true);
    }
  }
}

/**
 * The line descending from the commit on row `childRow`, as this row draws it. Lines are
 * picked out by the commit they come from rather than by column, because a diagonal
 * drawn across its neighbours shares a column with them for a row at a time.
 */
function lineOf(row: GraphRow, childRow: number)
{
  return row.lines.find((line) => line.childRow === childRow);
}

describe('buildGraph', () =>
{
  it('draws a linear history as one column', () =>
  {
    const rows = layout(['a: b', 'b: c', 'c:']);

    expect(ascii(rows)).toBe(['*', '|', '*', '|', '*'].join('\n'));
    expect(rows.map((row) => row.laneCount)).toEqual([1, 1, 1]);
  });

  it('gives a merge parent a column of its own and keeps the first parent in place', () =>
  {
    const rows = layout(['m: a b', 'a: c', 'b: c', 'c:']);

    expect(ascii(rows)).toBe(
      [
        '*',
        '|\\',
        '* |',
        '| |',
        '| *',
        '|/|',
        '*'
      ].join('\n')
    );
    expect(rows.map((row) => row.nodeLane)).toEqual([0, 0, 1, 0]);
    expectQuietRowsStayQuiet(rows);
    expectNoGaps(rows);
  });

  it('closes the gutter up when a line ends, in the row where it ended', () =>
  {
    // `b`'s column ends at row 2, so `c`'s line moves from column 2 to column 1 in that
    // row: one diagonal, in the row where the room appeared, and never afterwards.
    const rows = layout(['a: x', 'b: y', 'c: z', 'y:', 'x:', 'z:']);

    expect(rows[2]!.nodeLane).toBe(2);
    const moving = rows[3]!.lines.find((line) => line.fromLane === 2);
    expect(moving?.toLane).toBe(1);
    expectQuietRowsStayQuiet(rows);
    expectNoGaps(rows);
  });

  it('runs a line off the bottom when its parent is outside the loaded set', () =>
  {
    const rows = layout(['a: unloaded']);

    expect(rows[0]!.lines).toEqual([
      { fromLane: -1, toLane: 0, color: expect.any(Number), childRow: 0 }
    ]);
  });

  it('keeps the mainline in column 0 while branches come and go', () =>
  {
    const rows = layout(['t: a', 'f: g', 'a: b', 'b: g', 'g: h', 'h:']);

    expect(rows.map((row) => row.nodeLane)).toEqual([0, 1, 0, 0, 0, 0]);
    expectQuietRowsStayQuiet(rows);
    expectNoGaps(rows);
  });

  it('narrows again once a column empties', () =>
  {
    // `x` is a commit with nothing above or below it: it takes a column for its own row
    // and gives it straight back.
    const rows = layout(['a: b', 'x:', 'b: c', 'c:']);

    expect(rows.map((row) => row.laneCount)).toEqual([1, 2, 1, 1]);
    expectNoGaps(rows);
  });
});

describe('a line arriving from several columns away', () =>
{
  // `t3`'s line sits in column 3 and its commit `m` ends up in column 0, three columns
  // to its left. Crossing three columns inside one row is a five-degree line; crossing
  // one per row over the three rows above it is a diagonal.
  const spec = ['a: b', 't1: u1', 't2: u2', 't3: m', 'b: c', 'c: m', 'm:', 'u1:', 'u2:'];

  it('is drawn as a diagonal down the rows above it', () =>
  {
    const rows = layout(spec);
    const arrival = rows[6]!;
    expect(arrival.nodeLane).toBe(0);

    // One column per row, closing back onto its own column at the top.
    expect(lineOf(arrival, 3)).toMatchObject({ fromLane: 1, toLane: -1 });
    expect(lineOf(rows[5]!, 3)).toMatchObject({ fromLane: 2, toLane: 1 });
    expect(lineOf(rows[4]!, 3)).toMatchObject({ fromLane: 3, toLane: 2 });
  });

  it('moves nobody else to do it', () =>
  {
    // The lines it crosses are exactly where they were: the diagonal is drawn over them,
    // not shoved through them.
    const rows = layout(spec);

    for (const row of [rows[4]!, rows[5]!])
    {
      expect(lineOf(row, 1)).toMatchObject({ fromLane: 1, toLane: 1 });
      expect(lineOf(row, 2)).toMatchObject({ fromLane: 2, toLane: 2 });
    }
  });
});

describe('merging lanes with a common parent', () =>
{
  const spec = ['m: a b', 'a: c', 'b: c', 'c:'];

  it('joins a line into the column already heading there, in that column\'s colour', () =>
  {
    // `m2`'s second parent is `b`, which `m1` is already heading for. It leans into that
    // column rather than opening one, and it is drawn in that column's colour: its own
    // would put a stub of a second colour under the node and stop at the row's edge.
    const rows = layout(['m1: a b', 'm2: c b', 'a: z', 'c: z', 'b:', 'z:'], true);

    const joining = rows[1]!.lines.find((line) => line.fromLane < 0 && line.toLane === 1);
    const joined = rows[0]!.lines.find((line) => line.toLane === 1);
    expect(joining).toBeDefined();
    expect(joining!.color).toBe(joined!.color);
  });

  it('runs the two side by side when it is off', () =>
  {
    const rows = layout(spec, false);

    expect(rows[2]!.lines).toContainEqual({
      fromLane: -1,
      toLane: 1,
      color: expect.any(Number),
      childRow: 2
    });
    // Both reach `c` in their own column and end there.
    expect(rows[3]!.laneCount).toBe(2);
    expect(rows[3]!.lines.map((line) => line.fromLane)).toEqual([0, 1]);
  });

  it('never pulls a line that carries a commit onward into another column', () =>
  {
    // A column to the *right* is already heading for `p` when `c`, in column 1, gets
    // there. Joining it would walk `c`'s line sideways, so `c` keeps its own column and
    // the two meet at `p` instead.
    const rows = layout(['z: w', 'b: c', 'q: r', 'a: p', 'c: p', 'p:', 'w:', 'r:']);

    expect(rows[4]!.nodeLane).toBe(1);
    expect(rows[4]!.lines).toContainEqual({
      fromLane: -1,
      toLane: 1,
      color: expect.any(Number),
      childRow: 4
    });
    // Both lines are still open a row later, in their own columns.
    expect(rows[5]!.lines.filter((line) => line.toLane < 0).length).toBe(2);
    expectQuietRowsStayQuiet(rows);
  });

  it('draws a parent listed twice as one line, or two with it off', () =>
  {
    expect(layout(['a: p p', 'p:'], true)[0]!.lines.map((line) => line.toLane)).toEqual([0, 0]);
    expect(layout(['a: p p', 'p:'], false)[0]!.lines.map((line) => line.toLane)).toEqual([0, 1]);
  });
});

describe('the defaults', () =>
{
  it('merge lanes having a common parent', () =>
  {
    expect(DEFAULT_GRAPH_CONFIG).toEqual({ mergeCommonParentLanes: true });
  });
});
