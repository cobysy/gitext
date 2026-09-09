/**
 * `runFsck` against real git.
 *
 * The unit tests describe output this file proves git actually produces. Four things
 * matter here and none of them is visible from the parser:
 *
 * - **`--no-reflogs` is what makes recovery work.** The reflog reaches everything you did
 *   in the last ninety days, so while it counts as a root a commit you just `reset --hard`
 *   away is still reachable and fsck says nothing about it. Without this flag the dialog
 *   would open empty in exactly the situation somebody opened it for.
 * - **`--unreachable` and dangling are different questions.** Only the tip of a discarded
 *   branch is dangling; the commits behind it are merely unreachable.
 * - **A commit's metadata comes from a second command.** fsck prints `dangling commit
 *   <sha>` and nothing else, and a window of bare hex is not a recovery tool.
 * - **fsck exits 0 with a hundred orphaned commits.** It is worth pinning, because the
 *   opposite assumption is the natural one and would have made every healthy repository
 *   look like an error.
 */

import { mkdir, mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFsck } from '@main/git/fsck.js';
import { runGit } from '@main/git/runner.js';

let root = '';
let repo = '';
/** The commit thrown away by `reset --hard`, which the whole dialog exists to find. */
let orphaned = '';
/** A loose blob nothing ever referenced. */
let looseBlob = '';

const ID = [
  '-c',
  'user.name=Lost Author',
  '-c',
  'user.email=lost@example.com',
  '-c',
  'commit.gpgsign=false'
];

beforeAll(async () =>
{
  // git canonicalizes paths and /var is a symlink to /private/var on macOS.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-fsck-test-')));
  repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);

  await writeFile(join(repo, 'a.txt'), 'one\n');
  await runGit(repo, ['add', '.']);
  // Pinned dates, per the rule about tests that assert on log order: a fixture commits
  // faster than a second and ties resolve however git likes.
  await runGit(repo, [
    ...ID,
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'the first commit',
    '--date=2024-01-01T10:00:00Z'
  ]);

  await writeFile(join(repo, 'b.txt'), 'two\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, [
    ...ID,
    'commit',
    '-m',
    'the commit that gets thrown away',
    '--date=2024-01-02T10:00:00Z'
  ]);
  orphaned = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();

  // The gesture this dialog is for: the commit is gone from the branch but still in the
  // object database, entire and readable, until gc removes it.
  await runGit(repo, ['reset', '--hard', 'HEAD~1']);

  // A blob nothing points at: the other thing fsck reports, and the one that is dangling
  // rather than merely unreachable.
  looseBlob = (
    await runGit(repo, ['hash-object', '-w', '--stdin'], { stdin: 'never referenced\n' })
  ).trim();
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('runFsck', () =>
{
  it('finds the loose blob with no options at all, and does not fail doing it', async () =>
  {
    const found = await runFsck(repo);

    // Exits 0: dangling objects are a report, not an error. The opposite assumption would
    // have turned every repository with a stray blob into an error dialog.
    expect(found.some((object) => object.sha === looseBlob && object.kind === 'blob')).toBe(
      true
    );
  });

  it('hides a reset-away commit behind the reflog until --no-reflogs', async () =>
  {
    const withReflogs = await runFsck(repo, { unreachable: true });
    expect(withReflogs.some((object) => object.sha === orphaned)).toBe(false);

    const without = await runFsck(repo, { unreachable: true, noReflogs: true });
    expect(without.some((object) => object.sha === orphaned)).toBe(true);
  });

  it('describes the commits it finds, which fsck itself does not', async () =>
  {
    const found = await runFsck(repo, { unreachable: true, noReflogs: true });
    const commit = found.find((object) => object.sha === orphaned);

    expect(commit).toBeDefined();
    expect(commit?.subject).toBe('the commit that gets thrown away');
    expect(commit?.author).toBe('Lost Author');
    expect(commit?.date).toBeGreaterThan(0);
    expect(commit?.parents).toHaveLength(1);
  });

  it('describes nothing for a blob, which has nothing to describe', async () =>
  {
    const found = await runFsck(repo, { unreachable: true, noReflogs: true });
    const blob = found.find((object) => object.sha === looseBlob);

    expect(blob).toBeDefined();
    // Absent rather than empty: an empty author column would read as an object by nobody.
    expect(blob?.author).toBeUndefined();
    expect(blob?.subject).toBeUndefined();
  });

  it('reports more objects with --unreachable than without', async () =>
  {
    // Dangling and unreachable are different questions: the tree and the parent commit of
    // a discarded tip are unreachable without being dangling.
    const dangling = await runFsck(repo, { noReflogs: true });
    const unreachable = await runFsck(repo, { unreachable: true, noReflogs: true });

    expect(unreachable.length).toBeGreaterThan(dangling.length);
  });

  it('finds nothing in a repository that has lost nothing', async () =>
  {
    const clean = join(root, 'clean');
    await mkdir(clean, { recursive: true });
    await runGit(clean, ['init', '-b', 'main']);
    await writeFile(join(clean, 'a.txt'), 'one\n');
    await runGit(clean, ['add', '.']);
    await runGit(clean, [...ID, 'commit', '-m', 'only commit']);

    expect(await runFsck(clean, { unreachable: true, noReflogs: true })).toEqual([]);
  });
});
