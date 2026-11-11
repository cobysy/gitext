/**
 * Refusing a worktree before its directory is moved to the Trash, against real git.
 *
 * Once a directory has been moved there is nothing left for git to check, so these have
 * to be the questions `git worktree remove` asks, answered the same way. Each case is
 * one of git's refusals, and the `--force` cases are git's overrides.
 */

import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '@main/git/runner.js';
import { checkWorktreeRemovable } from '@main/git/worktree.js';

let root = '';
let repo = '';

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

async function addWorktree(name: string): Promise<string>
{
  const where = join(root, name);
  await runGit(repo, ['worktree', 'add', '--detach', where, 'HEAD']);
  return where;
}

beforeAll(async () =>
{
  // Resolved: git canonicalizes, and on macOS `/var` is a symlink to `/private/var`.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-wt-removable-')));
  repo = join(root, 'repo');
  await mkdir(repo);
  await runGit(repo, ['init', '-q']);
  await runGit(repo, [...IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'first']);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('checkWorktreeRemovable', () =>
{
  it('passes a clean worktree', async () =>
  {
    await expect(checkWorktreeRemovable(repo, await addWorktree('clean'), false)).resolves.toBeUndefined();
  });

  it('refuses one with an untracked file, unless forced', async () =>
  {
    const dirty = await addWorktree('dirty');
    await writeFile(join(dirty, 'new.txt'), 'x\n');
    await expect(checkWorktreeRemovable(repo, dirty, false)).rejects.toThrow('untracked');
    await expect(checkWorktreeRemovable(repo, dirty, true)).resolves.toBeUndefined();
  });

  // An ignored file is not a change: git's own test leaves it out, which is what lets a
  // worktree with its dependencies installed go without `--force`.
  it('passes one whose only extra files are ignored', async () =>
  {
    const built = await addWorktree('built');
    // `info/exclude` lives in the shared directory, so every worktree reads it.
    await writeFile(join(repo, '.git', 'info', 'exclude'), 'node_modules/\n');
    await mkdir(join(built, 'node_modules'));
    await writeFile(join(built, 'node_modules', 'dep.js'), 'x\n');
    await expect(checkWorktreeRemovable(repo, built, false)).resolves.toBeUndefined();
  });

  it('refuses a locked one, forced or not', async () =>
  {
    const locked = await addWorktree('locked');
    await runGit(repo, ['worktree', 'lock', locked]);
    await expect(checkWorktreeRemovable(repo, locked, true)).rejects.toThrow('locked');
  });

  it('refuses one holding a submodule repository, unless forced', async () =>
  {
    const holder = await addWorktree('holder');
    const gitDir = (await runGit(holder, ['rev-parse', '--absolute-git-dir'])).trim();
    await mkdir(join(gitDir, 'modules'));
    await expect(checkWorktreeRemovable(repo, holder, false)).rejects.toThrow('submodules');
    await expect(checkWorktreeRemovable(repo, holder, true)).resolves.toBeUndefined();
  });

  it('passes one whose directory is already gone', async () =>
  {
    const moved = await addWorktree('moved');
    await writeFile(join(moved, 'new.txt'), 'x\n');
    await rename(moved, `${moved}-elsewhere`);
    await expect(checkWorktreeRemovable(repo, moved, false)).resolves.toBeUndefined();
  });

  it('refuses the repository itself, and anything not one of its worktrees', async () =>
  {
    await expect(checkWorktreeRemovable(repo, repo, true)).rejects.toThrow('not a linked worktree');
    await expect(checkWorktreeRemovable(repo, join(root, 'nowhere'), true)).rejects.toThrow('not a linked worktree');
  });
});
