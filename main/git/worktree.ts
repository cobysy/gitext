/**
 * Linked worktrees. The main repo is always the first entry (isMain=true), so the
 * list is never empty.
 */

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
