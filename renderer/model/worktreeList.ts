/**
 * The worktree manager's list, worked out without a DOM: where the worktrees live, what
 * each row says, and which of a pick `git worktree remove` can be given.
 *
 * Paths are folded relative to the deepest directory they all sit under. Every worktree
 * of one repository shares a long prefix, so a tree of absolute paths opens on a chain of
 * folders that say nothing; relative to their common directory, the first level is
 * already the one that tells them apart, and a directory of worktrees is one folder row.
 */

import type { WorktreeEntry } from '@shared/types.js';

/** A worktree as the tree folds it: its path below the common directory. */
export interface WorktreeTreeEntry {
  path: string;
  worktree: WorktreeEntry;
}

/** The directory every path is inside, with its trailing slash. Never a path itself: each one keeps at least its own name. */
export function commonDir(paths: readonly string[]): string
{
  const dirs = paths.map((path) => path.split('/').slice(0, -1));
  if (dirs.length === 0)
  {
    return '';
  }
  const first = dirs[0]!;
  let depth = 0;
  while (depth < first.length && dirs.every((segments) => segments[depth] === first[depth]))
  {
    depth++;
  }
  return `${first.slice(0, depth).join('/')}/`;
}

export function treeEntries(worktrees: readonly WorktreeEntry[]): { base: string; entries: WorktreeTreeEntry[] }
{
  const base = commonDir(worktrees.map((entry) => entry.path));
  const entries = worktrees.map((worktree) => ({ path: worktree.path.slice(base.length), worktree }));
  return { base, entries };
}

/** Whether `git worktree remove` can be asked to drop it: never the repository's own, never the one this window has open. */
export function isRemovable(entry: WorktreeEntry, openPath: string | null): boolean
{
  return !entry.isMain && entry.path !== openPath;
}

/** The states a row reads out after its branch, the branch itself being a ref the row sets in code. */
export function worktreeStates(entry: WorktreeEntry, openPath: string | null): string[]
{
  const states: string[] = [];
  if (!entry.branch)
  {
    if (entry.isDetached)
    {
      states.push('detached');
    }
    else
    {
      states.push('no branch');
    }
  }
  if (entry.isMain)
  {
    states.push('the repository');
  }
  // Both, not one or the other: the main worktree is usually also the one this window
  // has open, and which of the two you wanted to know is not for the list to decide.
  if (entry.path === openPath)
  {
    states.push('you are here');
  }
  if (entry.isLocked)
  {
    states.push('locked');
  }
  if (entry.prunable)
  {
    states.push('missing');
  }
  return states;
}
