/**
 * `listStaleBranches` against the real git binary.
 *
 * The whole feature turns on one claim: that a squash-merged branch can be told apart
 * from a branch with unlanded work. Both look identical to `git branch --merged`, and
 * getting it wrong deletes someone's work with `-D`. So the fixture builds all four
 * cases against real git rather than asserting on a parser.
 */

import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listStaleBranches } from '@main/git/branchCleanup.js';
import { runGit } from '@main/git/runner.js';

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

async function commitFile(name: string, body: string, message: string): Promise<void>
{
  await writeFile(join(repo, name), body, 'utf8');
  await runGit(repo, ['add', '--', name]);
  await runGit(repo, [...IDENTITY, 'commit', '-m', message]);
}

beforeAll(async () =>
{
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-cleanup-')));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', 'repo']);

  await commitFile('base.txt', 'base\n', 'base');

  // 1. A branch merged the ordinary way: ancestry links it to main.
  await runGit(repo, ['checkout', '-b', 'merged-normally']);
  await commitFile('normal.txt', 'normal\n', 'normal work');
  await runGit(repo, ['checkout', 'main']);
  await runGit(repo, [...IDENTITY, 'merge', '--no-ff', 'merged-normally', '-m', 'merge']);

  // 2. A branch squash-merged: its content is on main under a brand-new commit that
  //    has no ancestry link back, which is exactly what `--merged` cannot see.
  //    Two commits, so the naive per-commit `git cherry` check cannot match either.
  await runGit(repo, ['checkout', '-b', 'squashed-away']);
  await commitFile('squash.txt', 'one\n', 'part one');
  await commitFile('squash.txt', 'one\ntwo\n', 'part two');
  await runGit(repo, ['checkout', 'main']);
  await runGit(repo, ['merge', '--squash', 'squashed-away']);
  await runGit(repo, [...IDENTITY, 'commit', '-m', 'squashed: the whole branch at once']);

  // 3. A branch with work that never landed anywhere.
  await runGit(repo, ['checkout', '-b', 'still-working']);
  await commitFile('wip.txt', 'wip\n', 'unfinished');

  await runGit(repo, ['checkout', 'main']);
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('listStaleBranches', () =>
{
  it('offers a normally-merged branch as contained', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.find((b) => b.name === 'merged-normally')?.reason).toBe('contained');
  });

  it('offers a squash-merged branch, which git itself cannot see is merged', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.find((b) => b.name === 'squashed-away')?.reason).toBe('squashed');
  });

  it('git agrees the squashed branch is not merged, which is why -D is needed', async () =>
  {
    // Pins the premise of the whole feature. If a future git learns to see squash
    // merges, `--merged` would list it and this test says so loudly rather than the
    // classifier quietly changing its answer.
    const merged = await runGit(repo, ['branch', '--merged', 'main', '--format=%(refname:short)']);
    expect(merged.split('\n').map((l) => l.trim())).not.toContain('squashed-away');
  });

  it('never offers a branch whose work has not landed', async () =>
  {
    const { stale, keptBack } = await listStaleBranches(repo, 'main');
    expect(stale.map((b) => b.name)).not.toContain('still-working');
    expect(keptBack.find((k) => k.name === 'still-working')?.why).toContain('not on main');
  });

  it('keeps back the checked-out branch rather than offering it', async () =>
  {
    await runGit(repo, ['checkout', 'still-working']);
    try
    {
      const { stale, keptBack } = await listStaleBranches(repo, 'main');
      expect(stale.map((b) => b.name)).not.toContain('still-working');
      expect(keptBack.find((k) => k.name === 'still-working')?.why).toBe('the current branch');
    }
    finally
    {
      await runGit(repo, ['checkout', 'main']);
    }
  });

  it('never offers the comparison branch itself', async () =>
  {
    const { stale } = await listStaleBranches(repo, 'main');
    expect(stale.map((b) => b.name)).not.toContain('main');
  });

  it('counts every local branch it examined', async () =>
  {
    const { examined } = await listStaleBranches(repo, 'main');
    // main, merged-normally, squashed-away, still-working
    expect(examined).toBe(4);
  });

  it('leaves the branches themselves alone: it only reports', async () =>
  {
    const before = await runGit(repo, ['branch', '--format=%(refname:short)']);
    await listStaleBranches(repo, 'main');
    const after = await runGit(repo, ['branch', '--format=%(refname:short)']);
    expect(after).toBe(before);
  });
});
