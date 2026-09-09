/**
 * The diff reads against real git.
 *
 * The unit tests pin the argv; this pins what git does with it. That is the half that
 * cannot be reasoned out: whether `--cached` with no revision works on an unborn
 * branch, whether `diff-tree --root` really emits a root commit's contents, what
 * `--no-index` exits with for an untracked file, and whether a rename survives being
 * asked for by both of its paths. Every one of those was checked against git before
 * the code was written; this is what keeps them checked.
 */

import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listDiffFiles, readDiffPatch } from '@main/git/diff.js';
import { readFileAt } from '@main/git/file.js';
import { runGit } from '@main/git/runner.js';
import type { DiffFileEntry, DiffRange } from '@shared/diff.js';

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

const index: DiffRange['to'] = { kind: 'index' };
const workingTree: DiffRange['to'] = { kind: 'workingTree' };

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

const pathsOf = (files: DiffFileEntry[]): string[] => files.map((file) => file.path);

/**
 * A changed-file entry, spelled the way `listDiffFiles` produces one.
 *
 * The three fields past the status are what the `--raw --numstat` listing adds: what the
 * row *is* (a blob here unless a test says otherwise), the mode git recorded, and whether
 * git found a text diff for it. A test that expects one back names the line counts too,
 * since those are the one field that differs with the change rather than with the file.
 */
const entry = (
  path: string,
  status: DiffFileEntry['status'],
  extra: Partial<DiffFileEntry> = {}
): DiffFileEntry => ({
  path,
  status,
  score: 0,
  kind: 'blob',
  mode: '100644',
  binary: false,
  ...extra
});

beforeAll(async () =>
{
  // git canonicalizes, and on macOS /var is a symlink to /private/var.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-diff-')));
  repo = join(root, 'repo');
  await mkdir(repo);

  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  await runGit(repo, ['add', 'a.txt']);
  first = await commit('first');

  await writeFile(join(repo, 'a.txt'), 'one\nTWO\nthree\n');
  await writeFile(join(repo, 'b.txt'), 'new file\n');
  await runGit(repo, ['add', '.']);
  second = await commit('second');
});

afterAll(async () =>
{
  if (root)
  {
    await rm(root, { recursive: true, force: true });
  }
});

describe('listDiffFiles', () =>
{
  it('lists what one commit changed against its parent', async () =>
  {
    const files = await listDiffFiles(repo, {
      from: { kind: 'commit', sha: first },
      to: { kind: 'commit', sha: second }
    });
    expect(files).toEqual([
      entry('a.txt', 'modified', { lines: { added: 1, deleted: 1 } }),
      entry('b.txt', 'added', { lines: { added: 1, deleted: 0 } })
    ]);
  });

  it('lists a root commit\'s own contents, which has no parent to diff against', async () =>
  {
    const files = await listDiffFiles(repo, { from: null, to: { kind: 'commit', sha: first } });
    expect(files).toEqual([entry('a.txt', 'added', { lines: { added: 3, deleted: 0 } })]);
  });

  it('separates what is staged from what is not', async () =>
  {
    await writeFile(join(repo, 'a.txt'), 'staged\ntwo\nthree\n');
    await runGit(repo, ['add', 'a.txt']);
    await writeFile(join(repo, 'b.txt'), 'edited but not staged\n');

    const staged = await listDiffFiles(repo, {
      from: { kind: 'commit', sha: second },
      to: index
    });
    const unstaged = await listDiffFiles(repo, { from: index, to: workingTree });

    expect(pathsOf(staged)).toEqual(['a.txt']);
    expect(pathsOf(unstaged)).toEqual(['b.txt']);
    await clean();
  });

  it('includes untracked files, which no diff mentions', async () =>
  {
    await writeFile(join(repo, 'untracked.txt'), 'hello\n');
    const files = await listDiffFiles(repo, { from: index, to: workingTree });
    // An untracked file carries no mode: it is in no index and in no tree to have one.
    // Its counts are read from the file, since no diff will ever count it.
    expect(files).toEqual([
      entry('untracked.txt', 'untracked', { mode: '', lines: { added: 1, deleted: 0 } })
    ]);
    await clean();
  });

  it('counts an untracked file\'s last line even without a newline to end it', async () =>
  {
    // git counts a new file's lines, and a file that does not end in a newline still has
    // that last line: reading the bytes here has to answer the same way.
    await writeFile(join(repo, 'unfinished.txt'), 'one\ntwo\nthree');
    const files = await listDiffFiles(repo, { from: index, to: workingTree });
    expect(files).toEqual([
      entry('unfinished.txt', 'untracked', { mode: '', lines: { added: 3, deleted: 0 } })
    ]);
    await clean();
  });

  it('counts nothing for an untracked binary file, as git counts nothing for one', async () =>
  {
    await writeFile(join(repo, 'blob.bin'), Buffer.from([0x01, 0x00, 0x02, 0x0a]));
    const files = await listDiffFiles(repo, { from: index, to: workingTree });
    expect(files).toEqual([
      entry('blob.bin', 'untracked', { mode: '', binary: true })
    ]);
    await clean();
  });

  it('leaves ignored files out', async () =>
  {
    await writeFile(join(repo, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(repo, 'ignored.txt'), 'noise\n');
    const files = await listDiffFiles(repo, { from: index, to: workingTree });
    expect(pathsOf(files)).toEqual(['.gitignore']);
    await clean();
  });

  it('reports a rename as one moved file, not a delete and an add', async () =>
  {
    await runGit(repo, ['mv', 'b.txt', 'moved.txt']);
    const files = await listDiffFiles(repo, {
      from: { kind: 'commit', sha: second },
      to: index
    });
    expect(files).toEqual([
      entry('moved.txt', 'renamed', { origPath: 'b.txt', score: 100, lines: { added: 0, deleted: 0 } })
    ]);
    await clean();
  });

  it('reports a deletion', async () =>
  {
    await unlink(join(repo, 'b.txt'));
    const files = await listDiffFiles(repo, { from: index, to: workingTree });
    expect(files).toEqual([entry('b.txt', 'deleted', { lines: { added: 0, deleted: 1 } })]);
    await clean();
  });

  it('reverses the range with -R rather than reporting the changes backwards', async () =>
  {
    await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    const forwards = await readDiffPatch(
      repo,
      { from: index, to: workingTree },
      entry('a.txt', 'modified')
    );
    const backwards = await readDiffPatch(
      repo,
      { from: workingTree, to: index },
      entry('a.txt', 'modified')
    );

    expect(forwards.text).toContain('+four');
    expect(backwards.text).toContain('-four');
    await clean();
  });

  it('still lists a whitespace-only change when whitespace is ignored', async () =>
  {
    // git's own behaviour, and worth pinning because it is asymmetric: `-w` suppresses
    // the *patch* but not the raw listing, which compares blobs. So the file
    // stays in the list and its diff comes back empty, which is why the viewer says
    // "once whitespace is ignored" rather than "identical".
    // HEAD's copy with trailing spaces added, and nothing else touched.
    await writeFile(join(repo, 'a.txt'), 'one  \nTWO\nthree\n');
    const options = { ignoreWhitespace: 'all' as const };

    const listed = await listDiffFiles(repo, { from: index, to: workingTree }, options);
    const patch = await readDiffPatch(
      repo,
      { from: index, to: workingTree },
      entry('a.txt', 'modified'),
      options
    );

    expect(pathsOf(listed)).toEqual(['a.txt']);
    expect(patch.text).toBe('');
    await clean();
  });
});

describe('readDiffPatch', () =>
{
  it('returns the unified diff for one file', async () =>
  {
    const patch = await readDiffPatch(
      repo,
      { from: { kind: 'commit', sha: first }, to: { kind: 'commit', sha: second } },
      entry('a.txt', 'modified')
    );
    expect(patch.path).toBe('a.txt');
    expect(patch.text).toContain('-two');
    expect(patch.text).toContain('+TWO');
    // One file asked for is one file back, even though the commit touched two.
    expect(patch.text).not.toContain('b.txt');
    expect(patch.truncated).toBe(false);
  });

  it('shows an untracked file as one long addition', async () =>
  {
    // `--no-index` exits 1 because the files differ, which is not a failure here.
    await writeFile(join(repo, 'fresh.txt'), 'line one\nline two\n');
    const patch = await readDiffPatch(
      repo,
      { from: index, to: workingTree },
      entry('fresh.txt', 'untracked', { mode: '' })
    );
    expect(patch.text).toContain('+line one');
    expect(patch.text).toContain('+line two');
    await clean();
  });

  it('keeps a rename whole by asking for both of its paths', async () =>
  {
    // Asking for the new path alone reports the file as wholly added: git needs the old
    // name in scope to detect that it is the same content.
    await runGit(repo, ['mv', 'a.txt', 'renamed.txt']);
    await writeFile(join(repo, 'renamed.txt'), 'one\nTWO\nthree\nfour\n');
    await runGit(repo, ['add', '.']);

    const patch = await readDiffPatch(
      repo,
      { from: { kind: 'commit', sha: second }, to: index },
      entry('renamed.txt', 'renamed', { origPath: 'a.txt', score: 90 })
    );
    expect(patch.text).toContain('rename from a.txt');
    expect(patch.text).toContain('+four');
    await clean();
  });

  it('carries the context-line count through to git', async () =>
  {
    const patch = await readDiffPatch(
      repo,
      { from: { kind: 'commit', sha: first }, to: { kind: 'commit', sha: second } },
      entry('a.txt', 'modified'),
      { contextLines: 0 }
    );
    // With no context, the hunk is the changed pair and nothing else. Checked by line,
    // because git puts the enclosing line's text on the `@@` header itself.
    expect(patch.text).toContain('@@ -2 +2 @@');
    expect(patch.text.split('\n')).not.toContain(' one');
  });
});

describe('readFileAt', () =>
{
  it('reads a commit\'s copy, the staged copy and the one on disk', async () =>
  {
    // Three sources for the same path, which is the whole reason this exists: "save this
    // file" means the version being looked at, and only two of the three are git objects.
    await writeFile(join(repo, 'a.txt'), 'staged\n');
    await runGit(repo, ['add', 'a.txt']);
    await writeFile(join(repo, 'a.txt'), 'on disk\n');

    const committed = await readFileAt(repo, { kind: 'commit', sha: first }, 'a.txt');
    const staged = await readFileAt(repo, { kind: 'index' }, 'a.txt');
    const working = await readFileAt(repo, { kind: 'workingTree' }, 'a.txt');

    expect(committed.toString()).toBe('one\ntwo\nthree\n');
    expect(staged.toString()).toBe('staged\n');
    expect(working.toString()).toBe('on disk\n');
    await clean();
  });

  it('returns bytes, so a blob that is not text survives the trip', async () =>
  {
    // Every other read here decodes as UTF-8, which would replace each invalid sequence
    // and save out a corrupt file.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    await writeFile(join(repo, 'blob.bin'), bytes);
    await runGit(repo, ['add', 'blob.bin']);
    const staged = await readFileAt(repo, { kind: 'index' }, 'blob.bin');
    expect([...staged]).toEqual([...bytes]);
    await clean();
  });

  it('refuses a path that climbs out of the repository', async () =>
  {
    await expect(
      readFileAt(repo, { kind: 'workingTree' }, '../outside.txt')
    ).rejects.toThrow(/outside the repository/);
  });
});

describe('an unborn branch', () =>
{
  it('diffs the index against the empty tree, with no HEAD to name', async () =>
  {
    const fresh = join(root, 'unborn');
    await mkdir(fresh);
    await runGit(fresh, ['init', '-b', 'main']);
    await writeFile(join(fresh, 'first.txt'), 'hello\n');
    await runGit(fresh, ['add', 'first.txt']);

    const files = await listDiffFiles(fresh, { from: null, to: index });
    expect(files).toEqual([entry('first.txt', 'added', { lines: { added: 1, deleted: 0 } })]);
  });
});

describe('what a changed file is, beyond what happened to it', () =>
{
  it('marks a file git found no text diff for as binary', async () =>
  {
    // git's own test is a NUL byte in the first 8000, and `--numstat` is where it says
    // so: `-` for both counts. Nothing else in the listing carries it.
    await writeFile(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
    await writeFile(join(repo, 'notes.txt'), 'plain text\n');
    await runGit(repo, ['add', '.']);

    const files = await listDiffFiles(repo, { from: { kind: 'commit', sha: second }, to: index });
    expect(files.map((file) => [file.path, file.binary])).toEqual([
      ['logo.png', true],
      ['notes.txt', false]
    ]);
    await clean();
  });

  it('keeps the mode of a symlink, whose contents are a path rather than a file', async () =>
  {
    await symlink('a.txt', join(repo, 'link'));
    await runGit(repo, ['add', '.']);

    const files = await listDiffFiles(repo, { from: { kind: 'commit', sha: second }, to: index });
    expect(files).toEqual([entry('link', 'added', { mode: '120000', lines: { added: 1, deleted: 0 } })]);
    await clean();
  });

  it('reads a gitlink as a submodule rather than as a file', async () =>
  {
    // A real submodule needs a repository to point at, and adding one over a `file://`
    // URL needs the protocol allowed: git refuses it by default.
    const inner = join(root, 'inner');
    await mkdir(inner);
    await runGit(inner, ['init', '-b', 'main']);
    await writeFile(join(inner, 'inner.txt'), 'inside\n');
    await runGit(inner, ['add', '.']);
    await runGit(inner, [...IDENTITY, 'commit', '-m', 'inner']);

    await runGit(repo, [
      '-c',
      'protocol.file.allow=always',
      ...IDENTITY,
      'submodule',
      'add',
      inner,
      'vendor/lib'
    ]);

    const files = await listDiffFiles(repo, { from: { kind: 'commit', sha: second }, to: index });
    const gitlink = files.find((file) => file.path === 'vendor/lib');
    expect(gitlink).toEqual(
      entry('vendor/lib', 'added', { kind: 'submodule', mode: '160000', lines: { added: 1, deleted: 0 } })
    );

    // The patch for one is a commit id on each side, which the viewer reads as a note.
    const patch = await readDiffPatch(
      repo,
      { from: { kind: 'commit', sha: second }, to: index },
      gitlink!
    );
    expect(patch.text).toContain('Subproject commit');

    await runGit(repo, ['submodule', 'deinit', '-f', 'vendor/lib']);
    await runGit(repo, ['rm', '-f', 'vendor/lib']);
    await rm(join(repo, '.git', 'modules'), { recursive: true, force: true });
    await clean();
  });
});
