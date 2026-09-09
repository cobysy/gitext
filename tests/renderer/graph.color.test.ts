/**
 * Lane colour: the seed, the modulo, the veto, and what a line inherits.
 *
 * The pictures in `graph.layout.test.ts` cannot see any of this: they carry lane
 * *positions* and nothing about hue, so every colour rule could be wrong and every
 * picture would still match.
 *
 * The rule the rest of them serve: **a line is one colour for its whole length**. A line
 * that changes colour part-way down reads as two branches, which is the one thing the
 * graph must never say when it is not true.
 */

import { describe, expect, it } from 'vitest';
import {
  GRAPH_COLOR_COUNT,
  hashSha,
  NO_COLOR,
  pickColor,
  veto,
  vetoesEverything
} from '@renderer/model/graph/palette.js';
import { buildGraph } from '@renderer/model/graph/layout.js';
import { DEFAULT_GRAPH_CONFIG } from '@renderer/model/graph/config.js';
import type { GraphInputCommit, GraphRow } from '@renderer/model/graph/types.js';

function commits(...spec: string[]): GraphInputCommit[]
{
  return spec.map((line) =>
  {
    const [sha, rest] = line.split(':');
    return { sha: sha!.trim(), parents: (rest ?? '').trim().split(/\s+/).filter(Boolean) };
  });
}

function layout(...spec: string[]): GraphRow[]
{
  return buildGraph(commits(...spec), DEFAULT_GRAPH_CONFIG);
}

describe('hashSha', () =>
{
  it('depends on the whole sha, so a colour survives a re-layout', () =>
  {
    expect(hashSha('deadbeef')).toBe(hashSha('deadbeef'));
    expect(hashSha('deadbeef')).not.toBe(hashSha('deadbeee'));
    // The last character counts too: a hash over a prefix would give two branches that
    // share one the same colour for the life of the repository.
    expect(hashSha('a'.repeat(39) + '0')).not.toBe(hashSha('a'.repeat(39) + '1'));
  });

  it('is unsigned, so the modulo that follows can never come out negative', () =>
  {
    for (const sha of ['', 'f'.repeat(40), '0', 'zzz'])
    {
      expect(hashSha(sha)).toBeGreaterThanOrEqual(0);
      expect(hashSha(sha) % GRAPH_COLOR_COUNT).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('pickColor', () =>
{
  /** The veto mask a list of colours makes. */
  function without(...colors: number[]): number
  {
    return colors.reduce(veto, 0);
  }

  it('takes the seed modulo the palette when nothing is vetoed', () =>
  {
    expect(pickColor(0, 0)).toBe(0);
    expect(pickColor(9, 0)).toBe(9 % GRAPH_COLOR_COUNT);
  });

  it('steps forward to the first colour the veto leaves', () =>
  {
    expect(pickColor(3, without(3))).toBe(4);
    expect(pickColor(3, without(3, 4))).toBe(5);
    expect(pickColor(3, without(3, 4, 5))).toBe(6);
    // The search wraps round rather than running off the end of the palette.
    expect(pickColor(6, without(6, 0, 1))).toBe(2);
  });

  it('gives back the seed rather than looping when everything is vetoed', () =>
  {
    const all = without(0, 1, 2, 3, 4, 5, 6);
    expect(vetoesEverything(all)).toBe(true);
    expect(pickColor(2, all)).toBe(2);
  });

  it('lets a veto of nothing through, so an absent neighbour rules nothing out', () =>
  {
    expect(veto(0, NO_COLOR)).toBe(0);
    expect(vetoesEverything(without(0, 1, 2, 3, 4, 5))).toBe(false);
  });
});

describe('what a line is coloured', () =>
{
  it('carries one colour the length of a branch', () =>
  {
    const rows = layout('a: b', 'b: c', 'c: d', 'd:');

    const colors = new Set(rows.flatMap((row) => row.lines.map((line) => line.color)));
    expect(colors.size).toBe(1);
    // And the nodes are that colour too, so a branch reads as one line, not a string of
    // beads.
    expect(new Set(rows.map((row) => row.color))).toEqual(colors);
  });

  it('gives a merge parent a colour of its own, different from the line it left', () =>
  {
    const rows = layout('m: a b', 'a: c', 'b: c', 'c:');

    const [firstParent, secondParent] = rows[0]!.lines;
    expect(secondParent!.color).not.toBe(firstParent!.color);
    // The merge commit itself belongs to the line it continues, not to the one it took in.
    expect(rows[0]!.color).toBe(firstParent!.color);
  });

  it('keeps a commit the colour of the line arriving at it', () =>
  {
    const rows = layout('m: a b', 'a: c', 'b: c', 'c:');

    // `b` is reached by the merge's second line, so it is that line's colour and not the
    // mainline's.
    expect(rows[2]!.color).toBe(rows[0]!.lines[1]!.color);
  });

  it('draws a line joining another column in that column\'s colour', () =>
  {
    // From the join downward the two are one line, so they are one colour. Drawing the
    // diagonal in its own colour instead leaves a stub of a second colour hanging under
    // the node, ending in mid-air at the row's edge.
    const rows = layout('m1: a b', 'm2: c b', 'a: z', 'c: z', 'b:', 'z:');

    const joining = rows[1]!.lines.find((line) => line.fromLane < 0 && line.toLane === 1);
    const joined = rows[0]!.lines.find((line) => line.toLane === 1);
    expect(joining!.color).toBe(joined!.color);
  });

  it('keeps a line that carries a commit onward in its own colour and column', () =>
  {
    // The other half of the rule above: a first-parent line is the commit's own history
    // going on, so it never joins anything and never changes colour. Two lines heading
    // for `c` meet at `c` rather than one of them bending into the other.
    const rows = layout('m: a b', 'a: c', 'b: c', 'c:');

    const carriedOn = rows[2]!.lines.find((line) => line.fromLane < 0);
    expect(carriedOn!.color).toBe(rows[2]!.color);
    expect(carriedOn!.toLane).toBe(rows[2]!.nodeLane);
  });

  it('colours a branch tip from its own line, not from one crossing the row', () =>
  {
    // `t` starts a branch beside a mainline that merely passes its row. The node has to
    // be the colour of the line it starts: taking the first line the row happens to hold
    // paints the node in the colour of a branch it has nothing to do with.
    const rows = layout('a: b', 't: u', 'b: c', 'c:');

    const own = rows[1]!.lines.find((line) => line.fromLane < 0);
    const crossing = rows[1]!.lines.find((line) => line.fromLane === 0 && line.toLane === 0);
    expect(rows[1]!.color).toBe(own!.color);
    expect(rows[1]!.color).not.toBe(crossing!.color);
  });

  it('never changes a line\'s colour part-way down, over a whole tangled history', () =>
  {
    const rows = layout(
      'h: g f',
      'g: e',
      'f: e d',
      'e: c',
      'd: c',
      'c: b',
      'b: a',
      'a:'
    );

    // Follow the columns: whatever colour leaves a row in a column has to be the colour
    // arriving in that column a row later. A column that two lines leave in the same row
    // is the one ambiguous case, and it is skipped rather than guessed at.
    for (let index = 0; index < rows.length - 1; index++)
    {
      const leaving = new Map<number, number[]>();
      for (const line of rows[index]!.lines)
      {
        if (line.toLane >= 0)
        {
          leaving.set(line.toLane, [...(leaving.get(line.toLane) ?? []), line.color]);
        }
      }
      for (const line of rows[index + 1]!.lines)
      {
        const above = leaving.get(line.fromLane);
        if (line.fromLane >= 0 && above?.length === 1)
        {
          expect(line.color).toBe(above[0]);
        }
      }
    }
  });

  it('is stable under re-layout, which is what makes a scroll calm', () =>
  {
    const spec = commits('m: a b', 'a: c', 'b: c', 'c: d', 'd:');

    expect(buildGraph(spec, DEFAULT_GRAPH_CONFIG)).toEqual(buildGraph(spec, DEFAULT_GRAPH_CONFIG));
  });
});
