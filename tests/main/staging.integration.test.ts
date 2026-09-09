/**
 * Partial staging against real git.
 *
 * `tests/renderer/stagePatch.test.ts` proves the patch says what I think it says. This proves
 * git agrees, which is the half that cannot be reasoned out, because a patch with
 * plausible-but-wrong line numbers does not fail: `git apply` either calls it corrupt,
 * or applies it somewhere else in the file and reports success. The only way to know
 * which patch is right is to apply it and read the index back.
 *
 * Every assertion here reads the *index*, not the working tree: staging a hunk must
 * change what is staged and leave the file on disk alone.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readDiffPatch } from '@main/git/diff.js';
import { applyPatchToIndex, reverseApplyFromIndex } from '@main/git/stage.js';
import { runGit } from '@main/git/runner.js';
import { parsePatch } from '@renderer/model/patch.js';
import { buildHunkPatch } from '@renderer/model/stagePatch.js';
import type { DiffFileEntry, DiffRange } from '@shared/diff.js';

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

/** The two pivots the commit screen shows: unstaged changes, and staged ones. */
const UNSTAGED: DiffRange = { from: { kind: 'index' }, to: { kind: 'workingTree' } };
const STAGED: DiffRange = { from: null, to: { kind: 'index' } };

const blob = (path: string): DiffFileEntry => ({
  path,
  status: 'modified',
  score: 0,
  kind: 'blob',
  mode: '100644',
  binary: false
});

/** What the index holds for a path, which is what staging is supposed to move. */
async function staged(path: string): Promise<string>
{
  return runGit(repo, ['show', `:${path}`]);
}

/** What is on disk, which staging must never touch. */
async function onDisk(path: string): Promise<string>
{
  return runGit(repo, ['show', `:${path}`], { allowFailure: true }).then(async () =>
  {
    const { readFile } = await import('node:fs/promises');
    return readFile(join(repo, path), 'utf8');
  });
}

/**
 * Take one hunk of a file's diff and put it in the index.
 *
 * The whole flow in four lines: read the patch git would show, parse it, rebuild one
 * hunk of it, and apply that. Exactly what the commit screen's hunk button does.
 */
async function stageHunk(path: string, index: number): Promise<void>
{
  const patch = await readDiffPatch(repo, UNSTAGED, blob(path));
  const file = parsePatch(patch.text)[0]!;
  const built = buildHunkPatch(file, file.hunks[index]!, { direction: 'stage' });
  expect(built).not.toBeNull();
  await applyPatchToIndex(repo, built!);
}

async function unstageHunk(path: string, index: number): Promise<void>
{
  const patch = await readDiffPatch(repo, STAGED, blob(path));
  const file = parsePatch(patch.text)[0]!;
  const built = buildHunkPatch(file, file.hunks[index]!, { direction: 'unstage' });
  expect(built).not.toBeNull();
  await reverseApplyFromIndex(repo, built!);
}

/** The same two, picking individual lines out of the hunk rather than taking all of it. */
async function stageLines(path: string, hunk: number, selected: ReadonlySet<number>): Promise<void>
{
  const patch = await readDiffPatch(repo, UNSTAGED, blob(path));
  const file = parsePatch(patch.text)[0]!;
  const built = buildHunkPatch(file, file.hunks[hunk]!, { selected, direction: 'stage' });
  expect(built).not.toBeNull();
  await applyPatchToIndex(repo, built!);
}

async function unstageLines(path: string, hunk: number, selected: ReadonlySet<number>): Promise<void>
{
  const patch = await readDiffPatch(repo, STAGED, blob(path));
  const file = parsePatch(patch.text)[0]!;
  const built = buildHunkPatch(file, file.hunks[hunk]!, { selected, direction: 'unstage' });
  expect(built).not.toBeNull();
  await reverseApplyFromIndex(repo, built!);
}

const TEN_LINES = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';

/**
 * A file whose last line has no newline after it: the shape the `\ No newline at end of
 * file` marker exists for. Committed alongside `a.txt` so `beforeEach` restores it.
 */
const NO_NEWLINE_BASE = 'a\nb\nold last';
const NO_NEWLINE_EDITED = 'a\nb\nnew last';

beforeAll(async () =>
{
  // git canonicalizes, and on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-staging-')));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-q', 'repo']);
  await writeFile(join(repo, 'a.txt'), TEN_LINES);
  await writeFile(join(repo, 'n.txt'), NO_NEWLINE_BASE);
  await runGit(repo, ['add', '-A']);
  await runGit(repo, [...IDENTITY, 'commit', '-m', 'base']);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () =>
{
  await runGit(repo, ['reset', '-q', 'HEAD']);
  await runGit(repo, ['checkout', '--', '.']);
});

describe('staging one hunk', () =>
{
  it('stages the first hunk and leaves the second unstaged', async () =>
  {
    // Two edits, far enough apart that git prints them as separate hunks.
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('one', 'ONE').replace('ten', 'TEN'));

    const before = await readDiffPatch(repo, UNSTAGED, blob('a.txt'));
    expect(parsePatch(before.text)[0]!.hunks).toHaveLength(2);

    await stageHunk('a.txt', 0);

    // The index has the first edit and not the second.
    const index = await staged('a.txt');
    expect(index).toContain('ONE');
    expect(index).toContain('ten');
    expect(index).not.toContain('TEN');

    // The working tree still has both: staging moved nothing on disk.
    const disk = await onDisk('a.txt');
    expect(disk).toContain('ONE');
    expect(disk).toContain('TEN');

    // And what is left unstaged is the second hunk alone.
    const after = await readDiffPatch(repo, UNSTAGED, blob('a.txt'));
    const hunks = parsePatch(after.text)[0]!.hunks;
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines.some((line) => line.text === 'TEN')).toBe(true);
  });

  it('stages the second hunk, whose line numbers are not the first hunk’s', async () =>
  {
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('one', 'ONE').replace('ten', 'TEN'));

    await stageHunk('a.txt', 1);

    const index = await staged('a.txt');
    expect(index).toContain('TEN');
    expect(index).toContain('one');
    expect(index).not.toContain('ONE');
  });

  it('stages a hunk that only adds lines', async () =>
  {
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('two\n', 'two\ninserted\n'));

    await stageHunk('a.txt', 0);

    expect(await staged('a.txt')).toContain('inserted');
  });

  it('stages a hunk that only deletes lines', async () =>
  {
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('five\n', ''));

    await stageHunk('a.txt', 0);

    expect(await staged('a.txt')).not.toContain('five');
  });

  it('stages both hunks one after the other, the second built from a re-read diff', async () =>
  {
    // The interesting part: after the first apply, the *unstaged* diff is different:
    // one hunk, at new line numbers. Building the second from the stale patch would
    // apply it in the wrong place, which is the failure this catches.
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('one', 'ONE').replace('ten', 'TEN'));

    await stageHunk('a.txt', 0);
    await stageHunk('a.txt', 0);

    const index = await staged('a.txt');
    expect(index).toContain('ONE');
    expect(index).toContain('TEN');

    // Nothing left unstaged at all.
    const after = await readDiffPatch(repo, UNSTAGED, blob('a.txt'));
    expect(after.text).toBe('');
  });
});

describe('staging some lines of a hunk', () =>
{
  it('stages one added line out of three', async () =>
  {
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('two\n', 'two\np\nq\nr\n'));

    const patch = await readDiffPatch(repo, UNSTAGED, blob('a.txt'));
    const file = parsePatch(patch.text)[0]!;
    const hunk = file.hunks[0]!;
    const q = hunk.lines.findIndex((line) => line.kind === 'add' && line.text === 'q');
    const built = buildHunkPatch(file, hunk, { selected: new Set([q]), direction: 'stage' })!;
    await applyPatchToIndex(repo, built);

    // Compared as lines: `r` is a substring of "three" and of "four", so a `toContain`
    // on the whole text would pass whatever happened.
    const lines = (await staged('a.txt')).split('\n');
    expect(lines).toContain('q');
    expect(lines).not.toContain('p');
    expect(lines).not.toContain('r');
  });

  it('stages a deletion while leaving the addition beside it unstaged', async () =>
  {
    // A replaced line is a delete and an add in one hunk. Taking only the delete is the
    // case where the unpicked addition must not appear in the patch at all.
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('five', 'FIVE'));

    const patch = await readDiffPatch(repo, UNSTAGED, blob('a.txt'));
    const file = parsePatch(patch.text)[0]!;
    const hunk = file.hunks[0]!;
    const deletion = hunk.lines.findIndex((line) => line.kind === 'delete');
    const built = buildHunkPatch(file, hunk, {
      selected: new Set([deletion]),
      direction: 'stage'
    })!;
    await applyPatchToIndex(repo, built);

    const index = await staged('a.txt');
    expect(index).not.toContain('five');
    expect(index).not.toContain('FIVE');
  });
});

describe('unstaging one hunk', () =>
{
  it('takes one hunk back out of the index and leaves the other staged', async () =>
  {
    await writeFile(join(repo, 'a.txt'), TEN_LINES.replace('one', 'ONE').replace('ten', 'TEN'));
    await runGit(repo, ['add', '--', 'a.txt']);

    const before = await readDiffPatch(repo, STAGED, blob('a.txt'));
    expect(parsePatch(before.text)[0]!.hunks).toHaveLength(2);

    await unstageHunk('a.txt', 0);

    // The first edit is out of the index; the second is still in it.
    const index = await staged('a.txt');
    expect(index).toContain('one');
    expect(index).not.toContain('ONE');
    expect(index).toContain('TEN');

    // The working tree is untouched: both edits are still on disk.
    const disk = await onDisk('a.txt');
    expect(disk).toContain('ONE');
    expect(disk).toContain('TEN');
  });

  it('unstages the second hunk, anchored on the index side rather than HEAD', async () =>
  {
    // The two sides sit at different line numbers once the file's length changes above
    // the hunk, which is what makes the anchor choice observable.
    await writeFile(
      join(repo, 'a.txt'),
      TEN_LINES.replace('two\n', 'two\nx\ny\nz\n').replace('ten', 'TEN')
    );
    await runGit(repo, ['add', '--', 'a.txt']);

    await unstageHunk('a.txt', 1);

    const index = await staged('a.txt');
    expect(index).toContain('x');
    expect(index).toContain('ten');
    expect(index).not.toContain('TEN');
  });
});

/**
 * A file with no trailing newline, staged a line at a time.
 *
 * The failure this guards against is not a rejected patch. `git apply` accepts a marker
 * that sits mid-body and runs the following line onto the end of the one above it, so the
 * index ends up holding a line that exists in neither HEAD nor the working tree, and it
 * reports success. Only reading the index back catches it, which is why these are here
 * rather than only in the unit tests.
 */
describe('staging part of a hunk at the end of a file with no newline', () =>
{
  /** Indexes of the deletion and the addition in the one hunk this edit produces. */
  const DELETE_AT = 2;
  const ADD_AT = 3;

  it('stages the addition alone without joining it to the line above', async () =>
  {
    await writeFile(join(repo, 'n.txt'), NO_NEWLINE_EDITED);

    await stageLines('n.txt', 0, new Set([ADD_AT]));

    // Both lines, each on its own: taking the addition and not the deletion means the
    // index keeps the old last line and gains the new one after it.
    expect(await staged('n.txt')).toBe('a\nb\nold last\nnew last');
    expect(await onDisk('n.txt')).toBe(NO_NEWLINE_EDITED);
  });

  it('stages the deletion alone', async () =>
  {
    await writeFile(join(repo, 'n.txt'), NO_NEWLINE_EDITED);

    await stageLines('n.txt', 0, new Set([DELETE_AT]));

    expect(await staged('n.txt')).toBe('a\nb\n');
  });

  it('stages the whole hunk', async () =>
  {
    await writeFile(join(repo, 'n.txt'), NO_NEWLINE_EDITED);

    await stageHunk('n.txt', 0);

    expect(await staged('n.txt')).toBe(NO_NEWLINE_EDITED);
  });

  it('unstages the deletion alone without joining the lines', async () =>
  {
    await writeFile(join(repo, 'n.txt'), NO_NEWLINE_EDITED);
    await runGit(repo, ['add', '--', 'n.txt']);

    await unstageLines('n.txt', 0, new Set([DELETE_AT]));

    // Putting the deletion back leaves the addition staged above it.
    expect(await staged('n.txt')).toBe('a\nb\nold last\nnew last');
  });

  it('unstages the whole hunk', async () =>
  {
    await writeFile(join(repo, 'n.txt'), NO_NEWLINE_EDITED);
    await runGit(repo, ['add', '--', 'n.txt']);

    await unstageHunk('n.txt', 0);

    expect(await staged('n.txt')).toBe(NO_NEWLINE_BASE);
  });
});
