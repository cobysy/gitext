/**
 * Linked worktrees. The main repo is always the first entry (isMain=true), so the
 * list is never empty.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { WorktreeEntry } from '@shared/types.js';
import { parseWorktrees } from './parse.js';
import { GIT_KIND_READ, runGit } from './runner.js';

const CMD_WORKTREE = 'worktree';
const SUBCOMMAND_LIST = 'list';
const FLAG_PORCELAIN = '--porcelain';
const FLAG_NUL_TERMINATED = '-z';

export function buildWorktreeListArgs(): string[]
{
  // Use -z: worktree paths can contain newlines.
  return [CMD_WORKTREE, SUBCOMMAND_LIST, FLAG_PORCELAIN, FLAG_NUL_TERMINATED];
}

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]>
{
  const out = await runGit(repoPath, buildWorktreeListArgs(), { kind: GIT_KIND_READ });
  return parseWorktrees(out);
}

/**
 * Refuse a worktree for the reasons `git worktree remove` would, before its directory is
 * moved anywhere: once the directory is gone, git has nothing left to check. The same
 * three questions git asks, in the same order:
 *
 * - **locked**: refused even with `--force`, since git wants it given twice and nothing
 *   here offers that. Unlock it first.
 * - **changes**: modified or untracked files, by git's own test (`status --porcelain
 *   --ignore-submodules=none`, ignored files not counted). `--force` overrides.
 * - **submodules**: a populated submodule keeps its repository in this worktree's own
 *   git directory, which removing the worktree deletes. `--force` overrides.
 *
 * A worktree whose directory is already gone passes: there is nothing in it to lose.
 */
export async function checkWorktreeRemovable(
  repoPath: string,
  worktreePath: string,
  force: boolean
): Promise<void>
{
  const entry = (await listWorktrees(repoPath)).find((worktree) => worktree.path === worktreePath);
  if (!entry || entry.isMain)
  {
    throw new Error(`'${worktreePath}' is not a linked worktree of this repository`);
  }
  if (entry.isLocked)
  {
    throw new Error(`'${worktreePath}' is locked: unlock it first`);
  }
  if (force || !existsSync(worktreePath))
  {
    return;
  }
  const changes = await runGit(worktreePath, ['status', '--porcelain', '--ignore-submodules=none'], {
    kind: GIT_KIND_READ
  });
  if (changes.trim())
  {
    throw new Error(`'${worktreePath}' contains modified or untracked files, use --force to delete it`);
  }
  const gitDir = (await runGit(worktreePath, ['rev-parse', '--absolute-git-dir'], { kind: GIT_KIND_READ })).trim();
  if (existsSync(path.join(gitDir, 'modules')))
  {
    throw new Error(`'${worktreePath}' contains submodules, use --force to delete it`);
  }
}
