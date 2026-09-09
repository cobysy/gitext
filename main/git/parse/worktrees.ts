import type { WorktreeEntry } from '@shared/types.js';

// Worktree attribute keys
const WORKTREE_PATH = 'worktree';
const WORKTREE_HEAD = 'HEAD';
const WORKTREE_BRANCH = 'branch';
const WORKTREE_BARE = 'bare';
const WORKTREE_DETACHED = 'detached';
const WORKTREE_LOCKED = 'locked';
const WORKTREE_PRUNABLE = 'prunable';
const BRANCH_PREFIX = 'refs/heads/';

/** Parse `git worktree list --porcelain -z`: NUL-separated, `key value` lines, empty line closes block. */
export function parseWorktrees(text: string): WorktreeEntry[]
{
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  const blank = (): WorktreeEntry => ({
    path: '',
    head: '',
    branch: null,
    isBare: false,
    isDetached: false,
    isLocked: false,
    lockReason: '',
    prunable: false,
    // The first worktree listed is the repository's own; git guarantees the order.
    isMain: entries.length === 0
  });

  for (const attribute of text.split('\0'))
  {
    if (!attribute)
    {
      current = null;
      continue;
    }

    const space = attribute.indexOf(' ');
    let key;
    if (space === -1)
    {
      key = attribute;
    }
    else
    {
      key = attribute.slice(0, space);
    }
    let value;
    if (space === -1)
    {
      value = '';
    }
    else
    {
      value = attribute.slice(space + 1);
    }

    if (key === WORKTREE_PATH)
    {
      current = blank();
      current.path = value;
      entries.push(current);
      continue;
    }
    if (!current)
    {
      continue;
    }

    switch (key)
    {
      case WORKTREE_HEAD:
        current.head = value;
        break;
      case WORKTREE_BRANCH:
        if (value.startsWith(BRANCH_PREFIX))
        {
          current.branch = value.slice(BRANCH_PREFIX.length);
        }
        else
        {
          current.branch = value;
        }
        break;
      case WORKTREE_BARE:
        current.isBare = true;
        break;
      case WORKTREE_DETACHED:
        current.isDetached = true;
        break;
      case WORKTREE_LOCKED:
        current.isLocked = true;
        current.lockReason = value;
        break;
      case WORKTREE_PRUNABLE:
        current.prunable = true;
        break;
    }
  }

  return entries;
}
