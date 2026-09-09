/**
 * The artificial rows against real git.
 *
 * The unit tests cover the decision, which rows exist, and what parents they get:
 * from a hand-built status. This covers the part they cannot: that a real
 * `git status --porcelain=v2` of a real working tree, through the real parser, still
 * reaches those decisions, and that the row's parent is a SHA `git log` would
 * actually emit. Getting that last part wrong is invisible to a unit test and shows
 * up on screen as a graph line that stops in mid-air.
 */

import { mkdtemp, rm, writeFile, mkdir, realpath, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRepoInfo, getStatus } from '@main/git/repo.js';
import { readLog } from '@main/git/log.js';
import { runGit } from '@main/git/runner.js';
import { INDEX_SHA, WORKING_TREE_SHA, buildArtificialRows } from '@shared/artificial.js';
import { buildGraph, DEFAULT_GRAPH_CONFIG } from '@renderer/model/graph/index.js';

let root = '';
let repo = '';

const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

/** Rows for the repo as it stands right now: status and HEAD read from real git. */
async function rowsNow(): Promise<ReturnType<typeof buildArtificialRows>>
{
  const [status, info] = await Promise.all([getStatus(repo), getRepoInfo(repo)]);
  return buildArtificialRows(status, info?.head ?? null);
}

/** Put the tree back to a clean checkout between tests. */
async function reset(): Promise<void>
{
  await runGit(repo, ['reset', '--hard']);
  await runGit(repo, ['clean', '-fdx']);
}

beforeAll(async () =>
{
  // git canonicalizes, and on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-artificial-')));
  repo = join(root, 'repo');
  await mkdir(repo);

  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'a.txt'), 'hello\n');
  await runGit(repo, ['add', 'a.txt']);
  await runGit(repo, [...IDENTITY, 'commit', '-m', 'initial commit']);
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

/** The columns one end of a row's lines is in, in column order and without repeats. */
function columns(lanes: readonly number[]): number[]
{
  return [...new Set(lanes.filter((lane) => lane >= 0))].sort((a, b) => a - b);
}

describe('artificial rows against a real working tree', () =>
{
  it('produces no rows on a clean checkout', async () =>
  {
    await reset();
    expect(await rowsNow()).toEqual([]);
  });

  it('produces only the working-tree row for an unstaged edit', async () =>
  {
    await reset();
    await writeFile(join(repo, 'a.txt'), 'edited\n');

    const rows = await rowsNow();
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA]);
  });

  it('produces only the working-tree row for an untracked file', async () =>
  {
    await reset();
    await writeFile(join(repo, 'untracked.txt'), 'new\n');

    const rows = await rowsNow();
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA]);
  });

  it('produces only the index row once everything is staged', async () =>
  {
    await reset();
    await writeFile(join(repo, 'a.txt'), 'staged\n');
    await runGit(repo, ['add', 'a.txt']);

    const rows = await rowsNow();
    expect(rows.map((r) => r.sha)).toEqual([INDEX_SHA]);
  });

  it('produces both when one file is staged and another is not', async () =>
  {
    await reset();
    await writeFile(join(repo, 'a.txt'), 'staged\n');
    await runGit(repo, ['add', 'a.txt']);
    await writeFile(join(repo, 'b.txt'), 'untracked\n');

    const rows = await rowsNow();
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA, INDEX_SHA]);
  });

  it('produces both for a file staged and then edited again', async () =>
  {
    await reset();
    await writeFile(join(repo, 'a.txt'), 'staged\n');
    await runGit(repo, ['add', 'a.txt']);
    await writeFile(join(repo, 'a.txt'), 'and edited again\n');

    const rows = await rowsNow();
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA, INDEX_SHA]);
  });

  it('notices a deletion', async () =>
  {
    await reset();
    await unlink(join(repo, 'a.txt'));

    const rows = await rowsNow();
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA]);
  });
});

describe('the parent chain reaches the real HEAD', () =>
{
  it('parents the bottom artificial row onto a SHA git log emits', async () =>
  {
    await reset();
    await writeFile(join(repo, 'a.txt'), 'staged\n');
    await runGit(repo, ['add', 'a.txt']);
    await writeFile(join(repo, 'b.txt'), 'untracked\n');

    const artificial = await rowsNow();
    const commits = await readLog(repo, {});

    // The whole point of `RepoInfo.head` being the full SHA: this comparison is
    // against what `git log` actually prints, not a seven-character prefix of it.
    expect(artificial[1]!.parents).toEqual([commits[0]!.sha]);

    // And the layout over the combined list is one continuous line: every node in lane
    // 0, and every line leaving a row arriving in the same column of the next one.
    const graph = buildGraph([...artificial, ...commits], DEFAULT_GRAPH_CONFIG);
    expect(graph.map((row) => row.nodeLane)).toEqual(graph.map(() => 0));
    for (let i = 0; i < graph.length - 1; i++)
    {
      const leaving = columns(graph[i]!.lines.map((line) => line.toLane));
      const arriving = columns(graph[i + 1]!.lines.map((line) => line.fromLane));
      expect(arriving).toEqual(leaving);
    }
  });

  it('leaves the chain rootless in an unborn repository', async () =>
  {
    const unborn = join(root, 'unborn');
    await mkdir(unborn);
    await runGit(unborn, ['init', '-b', 'main']);
    await writeFile(join(unborn, 'a.txt'), 'hello\n');

    const [status, info] = await Promise.all([getStatus(unborn), getRepoInfo(unborn)]);
    // An unborn branch has no HEAD commit, which is exactly the null case.
    expect(info?.head).toBeNull();

    const rows = buildArtificialRows(status, info?.head ?? null);
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA]);
    expect(rows[0]!.parents).toEqual([]);
  });
});
