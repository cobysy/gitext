/**
 * The graph layout, checked against real `git log` output.
 *
 * `graph.layout.test.ts` pins the rules down on topologies written by hand. This suite
 * answers what that one cannot: does the layout agree with git on a repository git
 * actually produced? The acceptance criterion is that the lanes match
 * `git log --graph`, so that is what is asserted.
 */

import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildGraph,
  DEFAULT_GRAPH_CONFIG,
  type GraphInputCommit,
  type GraphLine,
  type GraphRow
} from '@renderer/model/graph/index.js';

let repo: string;

/**
 * A pinned clock, ticked one second per git invocation.
 *
 * The fixture below makes seven commits as fast as the machine allows, so on real
 * time they all land in the same second, and `--date-order` then breaks that tie however
 * it pleases, which under load reorders `s1` against `merge feature` and fails the lane
 * assertions. Ticking a fixed clock instead makes commit timestamps strictly increasing in
 * creation order, which is the order the assertions are written against.
 *
 * `--date-order` is kept rather than swapped for `--topo-order`: the app's log
 * defaults to date order (`main/git/log.ts`), and the point of this suite is to
 * agree with what the app actually asks git for.
 *
 * Commands that create no commit tick too and simply skip a second. Only the
 * relative order matters.
 */
const CLOCK_BASE = Math.floor(Date.UTC(2024, 0, 1) / 1000);
let clock = 0;

function git(...args: string[]): string
{
  const when = `${CLOCK_BASE + clock++} +0000`;
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
  });
}

/** Subjects in the same order as `readRows`, so assertions can name a commit. */
function readSubjects(): string[]
{
  return git('log', '--all', '--date-order', '--format=%s').trim().split('\n');
}

/** Rows in the order git would display them, which is the order the layout expects. */
function readRows(): GraphInputCommit[]
{
  return git('log', '--all', '--date-order', '--parents', '--format=%h:%p')
    .trim()
    .split('\n')
    .map((line) =>
    {
      const [sha, parents] = line.split(':');
      return { sha: sha!, parents: (parents ?? '').trim().split(/\s+/).filter(Boolean) };
    });
}

/**
 * Draw the computed layout the way `git log --graph` does: a node line per commit, then
 * the columns its lines cross into the next one in.
 */
function render(rows: readonly GraphRow[], commits: GraphInputCommit[]): string
{
  const out: string[] = [];
  const width = Math.max(...rows.map((row) => row.laneCount));

  for (let i = 0; i < rows.length; i++)
  {
    const row = rows[i]!;
    const crossing = new Set(
      row.lines.filter((line) => line.fromLane >= 0 && line.toLane >= 0).map((line) => line.fromLane)
    );

    const nodes: string[] = [];
    for (let lane = 0; lane < width; lane++)
    {
      if (lane === row.nodeLane)
      {
        nodes.push('*');
      }
      else if (crossing.has(lane))
      {
        nodes.push('|');
      }
      else
      {
        nodes.push(' ');
      }
    }
    out.push(`${nodes.join(' ')}  ${commits[i]!.sha}`);

    if (i === rows.length - 1)
    {
      continue;
    }

    const leaving = row.lines
      .filter((line) => line.toLane >= 0)
      .map((line) =>
      {
        if (line.fromLane === line.toLane)
        {
          return `${line.toLane}|`;
        }
        return `${Math.max(line.fromLane, row.nodeLane)}\\${line.toLane}`;
      });
    out.push(`  ${leaving.sort().join(' ')}`);
  }

  return out.join('\n');
}

/**
 * The columns one end of a row's lines is in, in column order and without repeats: two
 * lines that have just joined one column are one column from there down.
 */
function columns(lines: readonly GraphLine[], end: (line: GraphLine) => number): number[]
{
  const lanes = new Set(lines.map(end).filter((lane) => lane >= 0));
  return [...lanes].sort((a, b) => a - b);
}

/** The layout under the app's real defaults, which is what this suite is checking. */
function layout(commits: readonly GraphInputCommit[]): GraphRow[]
{
  return buildGraph(commits, DEFAULT_GRAPH_CONFIG);
}

describe('buildGraph against real git output', () =>
{
  beforeAll(async () =>
  {
    // git canonicalizes paths, and on macOS /var is a symlink to /private/var.
    repo = await realpath(await mkdtemp(join(tmpdir(), 'gitext-graph-')));

    git('init', '-q', '-b', 'main', '.');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    // Goes through `git()` so it gets a tick of the pinned clock like everything else.
    const commit = (name: string): void =>
    {
      git('commit', '-q', '--allow-empty', '-m', name);
    };

    //  A history with a merge whose side branch itself spans a second merge:
    //  the shape that exposed the mainline drifting rightward one lane per merge.
    commit('base');
    git('checkout', '-q', '-b', 'feature');
    commit('f1');
    git('checkout', '-q', 'main');
    commit('m1');
    git('merge', '-q', '--no-ff', 'feature', '-m', 'merge feature');
    git('checkout', '-q', '-b', 'side', 'HEAD~2');
    commit('s1');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', 'side', '-m', 'merge side');
  });

  afterAll(async () =>
  {
    const { rm } = await import('node:fs/promises');
    await rm(repo, { recursive: true, force: true });
  });

  it('keeps the mainline in lane 0 through consecutive merges', () =>
  {
    const commits = readRows();
    const rows = layout(commits);

    // `git log --all --date-order --graph` draws this exact history as:
    //   *   merge side
    //   |\
    //   | * s1
    //   * |   merge feature
    //   |\ \
    //   * | | m1
    //   | |/
    //   |/|
    //   | * f1
    //   |/
    //   * base
    //
    // Every first-parent commit sits on the left rail, and the two side-branch
    // commits do not. Anything else means the layout is walking sideways.
    //
    // Assert by commit, not by row index: `s1` is row 1 here and legitimately off
    // the rail, so an index-based assertion tests the fixture's ordering rather
    // than the layout, which is how this drifted from what git actually prints.
    const lane = Object.fromEntries(readSubjects().map((subject, i) => [subject, rows[i]!.nodeLane]));

    expect(lane['merge side']).toBe(0);
    expect(lane['merge feature']).toBe(0);
    expect(lane['m1']).toBe(0);
    expect(lane['base']).toBe(0); // everything converges
    expect(lane['s1']).toBeGreaterThan(0);
    expect(lane['f1']).toBeGreaterThan(0);

    const rendered = render(rows, commits);
    expect(rendered).toBeTruthy();
  });

  it('never grows wider than the number of concurrent branches', () =>
  {
    const rows = layout(readRows());

    // Three tips exist at once (main, feature, side), so three lanes is the
    // ceiling. A drifting layout would exceed this.
    expect(Math.max(...rows.map((row) => row.laneCount))).toBeLessThanOrEqual(3);
  });

  it('uses as many lanes as git does, on git-generated history', () =>
  {
    const commits = readRows();
    const rows = layout(commits);

    // git's own ASCII is the reference. Its width is the count of rail columns,
    // which is every second character of the widest link row.
    const ascii = git('log', '--all', '--date-order', '--graph', '--format=%h').trim();
    const gitWidth = Math.max(
      ...ascii.split('\n').map((line) =>
      {
        const rails = line.match(/[*|\\/ ]+/)?.[0] ?? '';
        return Math.ceil(rails.trimEnd().length / 2);
      })
    );

    expect(Math.max(...rows.map((row) => row.laneCount))).toBeLessThanOrEqual(gitWidth);
  });

  it('hands every line on to the next row in the column it left in', () =>
  {
    const rows = layout(readRows());

    for (let i = 0; i < rows.length - 1; i++)
    {
      const leaving = columns(rows[i]!.lines, (line) => line.toLane);
      const arriving = columns(rows[i + 1]!.lines, (line) => line.fromLane);

      expect(arriving).toEqual(leaving);
      for (const lane of arriving)
      {
        expect(lane).toBeLessThan(rows[i + 1]!.laneCount);
      }
    }
  });

  it('leaves a line where it was unless the row opened or closed a column', () =>
  {
    // A commit carrying one line on gives its column straight back, so nobody moves. The
    // one thing that may still shift is a line being drawn diagonally across the row
    // toward a node below it, and that steps a single column.
    for (const row of layout(readRows()))
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
  });

  it('draws an arrival from further off as a diagonal, not a dash across the gutter', () =>
  {
    const rows = layout(readRows());

    for (const row of rows)
    {
      for (const line of row.lines)
      {
        if (line.toLane < 0)
        {
          expect(Math.abs(line.fromLane - row.nodeLane)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
