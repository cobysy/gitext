/**
 * The four editable repository files, against real git.
 *
 * Two claims here are the reason the module exists rather than a `readFile` in the dialog.
 * The first is where the files are: `info/exclude` and `config` live in the *git directory*,
 * which is only `<root>/.git` for an ordinary clone: in a linked worktree it is somewhere
 * else entirely, and an editor that guessed would read one file and write another.
 *
 * The second is that git validates its own config. A save that does not check turns a text
 * box into a repository where every subsequent command fails with `fatal: bad config line`,
 * so the check has to be real and it has to refuse.
 *
 * `stage.ts`'s ignore-rule functions are here too rather than in a file of their own: they
 * reach `.git/info/exclude` by a different route and have to agree about where it is.
 */

import { mkdtemp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRepoText, readRepoText, writeRepoText } from '@main/git/repoText.js';
import { readWorkingText, writeWorkingText } from '@main/git/file.js';
import { addIgnoreRules, readIgnoreRules } from '@main/git/stage.js';
import { runGit } from '@main/git/runner.js';

let root = '';
let repo = '';
let linked = '';

const ID = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false'
];

beforeAll(async () =>
{
  // git canonicalizes paths and /var is a symlink to /private/var on macOS.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-repotext-test-')));
  repo = join(root, 'repo');
  linked = join(root, 'linked');

  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'a.txt'), 'a\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, [...ID, 'commit', '-m', 'first']);
  await runGit(repo, ['worktree', 'add', linked, '-b', 'side']);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('readRepoText / writeRepoText', () =>
{
  it('reads a file that is not there as empty rather than failing', async () =>
  {
    // A repository need have no `.gitignore`, and the editor opens on that case constantly.
    expect(await readRepoText(repo, 'gitattributes')).toBe('');
  });

  it('creates the working-tree files and reads them back', async () =>
  {
    await writeRepoText(repo, 'gitignore', 'node_modules/\n*.log\n');
    expect(await readRepoText(repo, 'gitignore')).toBe('node_modules/\n*.log\n');
    expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('node_modules/\n*.log\n');

    await writeRepoText(repo, 'gitattributes', '*.txt text\n');
    expect(await readFile(join(repo, '.gitattributes'), 'utf8')).toBe('*.txt text\n');
  });

  it('creates .git/info/exclude, directory and all', async () =>
  {
    // `git init` makes `info/`, but a clone with a trimmed `.git` may not have it, so the
    // write has to make the directory rather than assume it.
    await rm(join(repo, '.git', 'info'), { recursive: true, force: true });
    await writeRepoText(repo, 'exclude', 'scratch/\n');
    expect(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')).toBe('scratch/\n');
  });

  it('replaces rather than appends', async () =>
  {
    // The dialog hands over the whole box. Appending would double the file on every save.
    await writeRepoText(repo, 'gitignore', 'one\n');
    await writeRepoText(repo, 'gitignore', 'two\n');
    expect(await readRepoText(repo, 'gitignore')).toBe('two\n');
  });

  it('finds the git directory a linked worktree shares, not the one it owns', async () =>
  {
    // Three paths are in play here and only one is right. `<linked>/.git` is a *file*, so a
    // join finds nothing; `--absolute-git-dir` is `…/.git/worktrees/side`, which holds that
    // worktree's own HEAD and index but no `config` at all. The shared directory is where
    // git actually keeps both of these files.
    expect(await readRepoText(linked, 'config')).toContain('[core]');

    await writeRepoText(linked, 'exclude', 'from-the-worktree\n');
    // Read back through the *main* repository: same file, which is the claim. Reading it
    // back through the worktree would pass with any path, right or wrong.
    expect(await readRepoText(repo, 'exclude')).toBe('from-the-worktree\n');
    expect(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')).toBe(
      'from-the-worktree\n'
    );
  });
});

describe('readIgnoreRules / addIgnoreRules', () =>
{
  it('appends to the same .git/info/exclude the editor opens', async () =>
  {
    // The two reach the same file by different routes: `stage.ts` appends a rule, this
    // module replaces the document: so they have to agree about where it is. They did not:
    // `stage.ts` joined `.git/info/exclude` onto the working tree, which is only where it
    // is for an ordinary clone.
    await writeRepoText(repo, 'exclude', 'from-the-editor\n');
    await addIgnoreRules(repo, 'exclude', ['from-the-rule-writer']);

    expect(await readRepoText(repo, 'exclude')).toBe('from-the-editor\nfrom-the-rule-writer\n');
    expect(await readIgnoreRules(repo, 'exclude')).toBe(await readRepoText(repo, 'exclude'));
  });

  it('finds it from a linked worktree too', async () =>
  {
    // Where the join was actually wrong. `<linked>/.git` is a file, so appending under it
    // fails outright, and reading it comes back empty, which reads as "no rules yet" and
    // means the ignore dialog offers to write a rule the file already carries.
    await writeRepoText(repo, 'exclude', 'shared-rule\n');

    expect(await readIgnoreRules(linked, 'exclude')).toBe('shared-rule\n');
    await addIgnoreRules(linked, 'exclude', ['added-from-the-worktree']);
    // Read back through the main repository: one file, not two.
    expect(await readRepoText(repo, 'exclude')).toBe('shared-rule\nadded-from-the-worktree\n');
  });

  it('still puts .gitignore in the working tree, where it is per-worktree', async () =>
  {
    // The other half of the same table, and the half that must *not* move: `.gitignore` is
    // a tracked file, so a worktree on another branch legitimately has a different one.
    await writeRepoText(linked, 'gitignore', 'only-here\n');
    expect(await readFile(join(linked, '.gitignore'), 'utf8')).toBe('only-here\n');
    expect(await readIgnoreRules(repo, 'gitignore')).not.toBe('only-here\n');
  });
});

describe('checkRepoText', () =>
{
  it('has nothing to say about the three files with no syntax', async () =>
  {
    // An unrecognised ignore rule matches nothing and an unrecognised attribute is ignored;
    // there is no such thing as an invalid one to warn about.
    expect(await checkRepoText(repo, 'gitignore', '!!! not a rule [[[')).toBeNull();
    expect(await checkRepoText(repo, 'gitattributes', '???')).toBeNull();
    expect(await checkRepoText(repo, 'exclude', '???')).toBeNull();
  });

  it('accepts a config git can parse', async () =>
  {
    expect(await checkRepoText(repo, 'config', '[user]\n\tname = Ada\n')).toBeNull();
  });

  it('refuses one git cannot, and says why', async () =>
  {
    const complaint = await checkRepoText(repo, 'config', '[user\n\tname = Ada\n');
    expect(complaint).toBeTruthy();
    // git names the line, which is the whole value of reporting its message rather than a
    // boolean: "line 1" is what turns "this is wrong" into something fixable.
    expect(complaint).toMatch(/line 1/);
    // And names the file being edited, not the temp copy git actually read: a path under
    // the system temp directory is one the reader has never seen and cannot go and look at.
    expect(complaint).toContain(join(repo, '.git', 'config'));
    expect(complaint).not.toContain('gitext-config-check');
  });

  it('leaves the real config alone while checking', async () =>
  {
    // The check writes a temp file and reads *that*. If it ever wrote through to the
    // repository, a rejected save would already have broken it.
    const before = await readRepoText(repo, 'config');
    await checkRepoText(repo, 'config', '[broken\n');
    expect(await readRepoText(repo, 'config')).toBe(before);
    // And the repository still works, which is the thing the check protects.
    await expect(runGit(repo, ['rev-parse', 'HEAD'])).resolves.toBeTruthy();
  });
});

/**
 * The editor window's other operand: an ordinary working file, named by path.
 *
 * The four targets above are addressed by name because two of them live in the git
 * directory. A working file cannot be enumerated, so it is addressed by path, and the
 * containment guard is what keeps that from being a channel that reads and writes anywhere
 * on disk.
 */
describe('readWorkingText / writeWorkingText', () =>
{
  it('reads a file in the working tree', async () =>
  {
    expect(await readWorkingText(repo, 'a.txt')).toBe('a\n');
  });

  it('reads an absent file as empty rather than failing', async () =>
  {
    // The list can be showing a file already deleted on disk; opening it empty beats an
    // error window over a row somebody just clicked.
    expect(await readWorkingText(repo, 'gone.txt')).toBe('');
  });

  it('writes one back, so git sees it as a change', async () =>
  {
    await writeWorkingText(repo, 'a.txt', 'edited\n');
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('edited\n');

    const status = await runGit(repo, ['status', '--porcelain']);
    expect(status).toContain('a.txt');

    await runGit(repo, ['checkout', '--', 'a.txt']);
  });

  it('refuses a path that climbs out of the repository', async () =>
  {
    // The guard is `resolveInRepo`'s; asserted here because this is the channel that
    // exposes it to a renderer.
    await expect(writeWorkingText(repo, '../escaped.txt', 'no')).rejects.toThrow(
      /outside the repository/
    );
    await expect(readWorkingText(repo, '/etc/hosts')).resolves.toBe('');
  });
});
