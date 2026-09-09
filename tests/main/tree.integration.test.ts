/**
 * The file tree against real git.
 *
 * The unit tests pin the argv; this pins what git does with it, and the answers here are
 * the ones that cannot be reasoned out: whether `ls-tree -r` really omits folders, what
 * the index says about a file staged for deletion, and whether the working-tree listing
 * still holds a path whose file has been removed, which is the one that would put a row
 * in the tree that cannot be opened.
 */

import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listTreeFiles, readBlob } from '@main/git/tree.js';
import { runGit } from '@main/git/runner.js';
import type { DiffEndpoint } from '@shared/diff.js';
import type { TreeEntry } from '@shared/tree.js';

let root = '';
let repo = '';
let first = '';
let second = '';

const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

const index: DiffEndpoint = { kind: 'index' };
const workingTree: DiffEndpoint = { kind: 'workingTree' };

async function commit(message: string): Promise<string>
{
  await runGit(repo, [...IDENTITY, 'commit', '-m', message]);
  return (await runGit(repo, ['rev-parse', 'HEAD'])).trim();
}

/** Back to a clean checkout of HEAD between tests. */
async function clean(): Promise<void>
{
  await runGit(repo, ['reset', '--hard']);
  await runGit(repo, ['clean', '-fdx']);
}

const pathsOf = (entries: TreeEntry[]): string[] => entries.map((entry) => entry.path);

beforeAll(async () =>
{
  // git canonicalizes, and on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-tree-')));
  repo = join(root, 'repo');
  await mkdir(repo);
  await mkdir(join(repo, 'src'));

  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'README.md'), '# title\n');
  await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  await runGit(repo, ['add', '.']);
  first = await commit('first');

  // The second commit deletes a file the first had, which is the difference between the
  // two lists the pane offers: the changed-files list has a row for it, the tree does not.
  await writeFile(join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
  await unlink(join(repo, 'README.md'));
  await runGit(repo, ['add', '-A']);
  second = await commit('second');
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('listTreeFiles at a commit', () =>
{
  it('lists what the commit contains, not what it changed', async () =>
  {
    expect(pathsOf(await listTreeFiles(repo, { kind: 'commit', sha: second }))).toEqual([
      'src/a.ts',
      'src/b.ts'
    ]);
  });

  it('has no row for a file the commit deleted', async () =>
  {
    const paths = pathsOf(await listTreeFiles(repo, { kind: 'commit', sha: second }));
    expect(paths).not.toContain('README.md');
  });

  it('still holds that file at the commit before it', async () =>
  {
    expect(pathsOf(await listTreeFiles(repo, { kind: 'commit', sha: first }))).toEqual([
      'README.md',
      'src/a.ts'
    ]);
  });

  it('returns files only: the folders are the renderer\'s to derive', async () =>
  {
    const entries = await listTreeFiles(repo, { kind: 'commit', sha: second });
    expect(entries.every((entry) => entry.kind === 'blob')).toBe(true);
    expect(pathsOf(entries)).not.toContain('src');
  });
});

describe('listTreeFiles in the working tree', () =>
{
  afterAll(clean);

  it('folds in an untracked file, which is in no tree and no index', async () =>
  {
    await writeFile(join(repo, 'scratch.txt'), 'notes\n');
    expect(pathsOf(await listTreeFiles(repo, workingTree))).toEqual([
      'scratch.txt',
      'src/a.ts',
      'src/b.ts'
    ]);
    await clean();
  });

  // The row that would otherwise fail to open: the index still holds the path, and the
  // file behind it is gone.
  it('drops a file deleted on disk but not staged', async () =>
  {
    await unlink(join(repo, 'src', 'b.ts'));
    expect(pathsOf(await listTreeFiles(repo, workingTree))).toEqual(['src/a.ts']);
    await clean();
  });

  it('keeps a file deleted on disk in the index listing, where it still is', async () =>
  {
    await unlink(join(repo, 'src', 'b.ts'));
    expect(pathsOf(await listTreeFiles(repo, index))).toEqual(['src/a.ts', 'src/b.ts']);
    await clean();
  });

  it('lists a staged new file in both the index and the working tree', async () =>
  {
    await writeFile(join(repo, 'src', 'c.ts'), 'export const c = 3;\n');
    await runGit(repo, ['add', 'src/c.ts']);
    expect(pathsOf(await listTreeFiles(repo, index))).toContain('src/c.ts');
    expect(pathsOf(await listTreeFiles(repo, workingTree))).toContain('src/c.ts');
    await clean();
  });
});

describe('readBlob', () =>
{
  afterAll(clean);

  const entry = (path: string, mode = '100644'): TreeEntry => ({
    path,
    kind: 'blob',
    mode
  });

  it('reads a file as it was at a commit, not as it is now', async () =>
  {
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 999;\n');
    const at = await readBlob(repo, { kind: 'commit', sha: first }, entry('src/a.ts'));
    expect(at.text).toBe('export const a = 1;\n');
    expect(at.binary).toBe(false);
    expect(at.truncated).toBe(false);
    await clean();
  });

  it('reads the file on disk for the working tree', async () =>
  {
    await writeFile(join(repo, 'src', 'a.ts'), 'edited\n');
    const at = await readBlob(repo, workingTree, entry('src/a.ts'));
    expect(at.text).toBe('edited\n');
    await clean();
  });

  it('reads the staged copy for the index', async () =>
  {
    await writeFile(join(repo, 'src', 'a.ts'), 'staged\n');
    await runGit(repo, ['add', 'src/a.ts']);
    await writeFile(join(repo, 'src', 'a.ts'), 'and then edited again\n');
    expect((await readBlob(repo, index, entry('src/a.ts'))).text).toBe('staged\n');
    await clean();
  });

  // A NUL byte is how git itself decides, and decoding one as UTF-8 would produce a wall
  // of replacement characters rather than the honest answer.
  it('says a file is binary rather than decoding it', async () =>
  {
    await writeFile(join(repo, 'blob.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
    await runGit(repo, ['add', 'blob.bin']);
    const at = await readBlob(repo, index, entry('blob.bin'));
    expect(at.binary).toBe(true);
    expect(at.text).toBe('');
    expect(at.size).toBe(5);
    await clean();
  });

  it('reports the size of an empty file without calling it binary', async () =>
  {
    await writeFile(join(repo, 'empty.txt'), '');
    const at = await readBlob(repo, workingTree, entry('empty.txt'));
    expect(at.binary).toBe(false);
    expect(at.text).toBe('');
    expect(at.size).toBe(0);
    await clean();
  });

  // `git show <sha>:<path>` on a gitlink prints the submodule's commit line, which is not
  // the file anyone clicked for: so this never asks.
  it('answers a submodule without reading anything', async () =>
  {
    const at = await readBlob(repo, { kind: 'commit', sha: second }, {
      path: 'externals/lib',
      kind: 'submodule',
      mode: '160000'
    });
    expect(at.submodule).toBe(true);
    expect(at.text).toBe('');
  });

  // A pane can name a path the revision never had: a listing still in flight, a history
  // walked past the file's creation. A rejected read puts git's `fatal:` where a sentence goes.
  it('reports a path the revision does not have rather than failing', async () =>
  {
    const at = await readBlob(repo, { kind: 'commit', sha: first }, entry('never/here.md'));
    expect(at.missing).toBe(true);
    expect(at.text).toBe('');
  });

  it('reports a path missing from the index and from disk the same way', async () =>
  {
    expect((await readBlob(repo, index, entry('never/here.md'))).missing).toBe(true);
    expect((await readBlob(repo, workingTree, entry('never/here.md'))).missing).toBe(true);
  });
});
