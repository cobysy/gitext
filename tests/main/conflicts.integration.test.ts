/**
 * Which commit each side of a conflict is, against real git.
 *
 * The claim is that the incoming side can be named for *every* operation that leaves a
 * conflict, and each one hides it somewhere different: a merge in `MERGE_HEAD`, a
 * cherry-pick in `CHERRY_PICK_HEAD`, a rebase in `REBASE_HEAD`, and a `git am` nowhere at
 * all, because a patch mid-apply is not a commit yet. That last case is the one worth a
 * real repository to test: its identity comes out of the sequencer's own scratch files,
 * whose format is git's rather than ours.
 *
 * The rebase case also pins down the inversion that makes "ours" and "theirs" dangerous:
 * mid-rebase, HEAD is the branch being replayed *onto*, and the commit being replayed:
 * the one the user actually wrote, is the incoming side.
 */

import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readConflictBlobs, resolveConflictSides } from '@main/git/conflicts.js';
import { runGit } from '@main/git/runner.js';

let root = '';

const ID = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

/** A repo whose `main` and `feature` both changed the same line of `file.txt`. */
async function makeDivergedRepo(name: string): Promise<string>
{
  const repo = join(root, name);
  await runGit(root, ['init', '-b', 'main', name]);

  await writeFile(join(repo, 'file.txt'), 'top\n1 tsp salt\nbottom\n');
  await runGit(repo, [...ID, 'add', '-A']);
  await runGit(repo, [...ID, 'commit', '-m', 'base']);

  await runGit(repo, [...ID, 'checkout', '-b', 'feature']);
  await writeFile(join(repo, 'file.txt'), 'top\n1 tsp sea salt\nbottom\n');
  await runGit(repo, [...ID, 'commit', '-am', 'feature: sea salt']);

  await runGit(repo, [...ID, 'checkout', 'main']);
  await writeFile(join(repo, 'file.txt'), 'top\n2 tsp salt\nbottom\n');
  await runGit(repo, [...ID, 'commit', '-am', 'main: double it']);

  return repo;
}

/** Run a command expected to stop on a conflict: a non-zero exit is the point. */
async function expectConflict(repo: string, argv: string[]): Promise<void>
{
  await expect(runGit(repo, [...ID, ...argv])).rejects.toThrow();
}

beforeAll(async () =>
{
  // git canonicalizes paths and /var is a symlink to /private/var on macOS.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-conflicts-test-')));
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('resolveConflictSides', () =>
{
  it('names both sides of a merge', async () =>
  {
    const repo = await makeDivergedRepo('merge');
    await expectConflict(repo, ['merge', 'feature']);

    const sides = await resolveConflictSides(repo);
    expect(sides.ours?.name).toBe('main');
    expect(sides.theirs?.name).toBe('feature');
    // Both are real commits, so both can be blamed.
    expect(sides.ours?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sides.theirs?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('names both sides of a cherry-pick', async () =>
  {
    const repo = await makeDivergedRepo('cherry');
    await expectConflict(repo, ['cherry-pick', 'feature']);

    const sides = await resolveConflictSides(repo);
    expect(sides.ours?.name).toBe('main');
    expect(sides.theirs?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reports the replayed commit as the incoming side of a rebase', async () =>
  {
    const repo = await makeDivergedRepo('rebase');
    await runGit(repo, [...ID, 'checkout', 'feature']);
    await expectConflict(repo, ['rebase', 'main']);

    const sides = await resolveConflictSides(repo);
    // Mid-rebase HEAD is the branch being replayed *onto*: git's "ours" is `main`, not
    // the branch the user is on. This inversion is why the dialog never shows git's word.
    expect(sides.ours?.name).toBe('main');
    // And the incoming side is the commit the user actually wrote.
    expect(sides.theirs?.sha).toMatch(/^[0-9a-f]{40}$/);
    const subject = await runGit(repo, ['log', '-1', '--format=%s', sides.theirs!.sha!]);
    expect(subject.trim()).toBe('feature: sea salt');
  });

  it('names the patch being applied by a `git am`, which is not a commit yet', async () =>
  {
    const repo = await makeDivergedRepo('am');
    const patch = await runGit(repo, [...ID, 'format-patch', '--stdout', 'main..feature']);
    const patchFile = join(root, 'am.patch');
    await writeFile(patchFile, patch);

    await expectConflict(repo, ['am', '--3way', patchFile]);

    const sides = await resolveConflictSides(repo);
    expect(sides.ours?.name).toBe('main');
    // No commit: the whole point of this case.
    expect(sides.theirs?.sha).toBeNull();
    // …but it can still be named, and attributed, from the sequencer's own scratch files.
    expect(sides.theirs?.name).toBe('feature: sea salt');
    expect(sides.theirs?.author).toBe('Test');
    expect(sides.theirs?.authorTime).toBeGreaterThan(0);
  });

  it('has no incoming side when nothing is in progress', async () =>
  {
    const repo = await makeDivergedRepo('clean');
    const sides = await resolveConflictSides(repo);
    expect(sides.ours?.name).toBe('main');
    expect(sides.theirs).toBeNull();
  });
});

describe('readConflictBlobs', () =>
{
  it('returns all three stages and the marked-up working copy', async () =>
  {
    const repo = await makeDivergedRepo('blobs');
    await expectConflict(repo, ['merge', 'feature']);

    const blobs = await readConflictBlobs(repo, 'file.txt');
    expect(blobs.base).toContain('1 tsp salt');
    expect(blobs.ours).toContain('2 tsp salt');
    expect(blobs.theirs).toContain('1 tsp sea salt');
    expect(blobs.working).toContain('<<<<<<<');
    expect(blobs.working).toContain('>>>>>>>');
  });

  it('reports a stage that is genuinely absent as null rather than empty', async () =>
  {
    // A delete/modify conflict: one side has no copy of the file at all, which is a
    // different thing from a file that is empty.
    const repo = join(root, 'deleted');
    await runGit(root, ['init', '-b', 'main', 'deleted']);
    await writeFile(join(repo, 'file.txt'), 'hello\n');
    await runGit(repo, [...ID, 'add', '-A']);
    await runGit(repo, [...ID, 'commit', '-m', 'base']);

    await runGit(repo, [...ID, 'checkout', '-b', 'gone']);
    await runGit(repo, [...ID, 'rm', 'file.txt']);
    await runGit(repo, [...ID, 'commit', '-m', 'delete it']);

    await runGit(repo, [...ID, 'checkout', 'main']);
    await writeFile(join(repo, 'file.txt'), 'hello there\n');
    await runGit(repo, [...ID, 'commit', '-am', 'edit it']);

    await expectConflict(repo, ['merge', 'gone']);

    const blobs = await readConflictBlobs(repo, 'file.txt');
    expect(blobs.base).toContain('hello');
    expect(blobs.ours).toContain('hello there');
    expect(blobs.theirs).toBeNull();
  });
});
