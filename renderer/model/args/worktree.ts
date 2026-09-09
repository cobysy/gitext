/**
 * git worktree argv. Path relative (useRelativePaths set) so moving worktree pair doesn't break links.
 */

const CHECKOUT_NEW_BRANCH = 'new-branch';
const CHECKOUT_EXISTING_BRANCH = 'existing-branch';
const CHECKOUT_DETACH = 'detach';

const CMD_WORKTREE = 'worktree';
const SUBCOMMAND_ADD = 'add';
const SUBCOMMAND_REMOVE = 'remove';
const SUBCOMMAND_PRUNE = 'prune';
const FLAG_CONFIG = '-c';
const FLAG_FORCE = '--force';
const FLAG_NEW_BRANCH = '-b';
const FLAG_DETACH = '--detach';
const FLAG_DRY_RUN = '--dry-run';
const FLAG_VERBOSE = '-v';
const CONFIG_RELATIVE_PATHS = 'worktree.useRelativePaths=true';

/** What the new worktree has checked out. */
export type WorktreeCheckout = 'new-branch' | 'existing-branch' | 'detach';

export interface WorktreeAddOptions {
  /** Where the worktree goes. Relative to the repository root wherever possible. */
  path: string;
  checkout?: WorktreeCheckout;
  /** The branch to create, or the one to check out, depending on `checkout`. */
  branch?: string;
  /** What a new or detached worktree starts at. Empty means HEAD, as git defaults. */
  startPoint?: string;
  /** Create it even when the branch is already checked out somewhere: `--force`. */
  force?: boolean;
  /**
   * Write `-c worktree.useRelativePaths=true` ahead of the command.
   *
   * Only when the repository has not set the key: writing a config value that is already
   * set to the same thing is a flag in the command log that reads as a decision nobody
   * made: the same rule D8 applied to `--update-refs`.
   */
  setRelativePaths?: boolean;
}

export function buildWorktreeAddArgs(options: WorktreeAddOptions): string[]
{
  const {
    path,
    checkout = CHECKOUT_NEW_BRANCH,
    branch = '',
    startPoint = '',
    force = false,
    setRelativePaths = false
  } = options;

  const target = path.trim();
  const name = branch.trim();
  const start = startPoint.trim();
  if (!target)
  {
    return [];
  }
  if (checkout !== CHECKOUT_DETACH && !name)
  {
    return [];
  }

  const args: string[] = [];
  // A `-c` before the subcommand, which is where git takes its own options.
  if (setRelativePaths)
  {
    args.push(FLAG_CONFIG, CONFIG_RELATIVE_PATHS);
  }
  args.push(CMD_WORKTREE, SUBCOMMAND_ADD);
  if (force)
  {
    args.push(FLAG_FORCE);
  }
  switch (checkout)
  {
    case CHECKOUT_NEW_BRANCH:
      args.push(FLAG_NEW_BRANCH, name);
      break;
    case CHECKOUT_DETACH:
      args.push(FLAG_DETACH);
      break;
    default:
      break;
  }
  args.push(target);
  // The commit-ish, last. For an existing branch it *is* the branch; for the other two
  // it is where the new branch or the detached HEAD starts, and HEAD when left empty.
  if (checkout === CHECKOUT_EXISTING_BRANCH)
  {
    args.push(name);
  }
  else if (start)
  {
    args.push(start);
  }
  return args;
}

export interface WorktreeRemoveOptions {
  path: string;
  /** Remove it even with uncommitted changes or an unmerged branch in it: `--force`. */
  force?: boolean;
}

export function buildWorktreeRemoveArgs(options: WorktreeRemoveOptions): string[]
{
  const { path, force = false } = options;
  if (!path.trim())
  {
    return [];
  }
  const args = [CMD_WORKTREE, SUBCOMMAND_REMOVE];
  if (force)
  {
    args.push(FLAG_FORCE);
  }
  args.push(path.trim());
  return args;
}

/**
 * `git worktree prune`: forget the worktrees whose directories are gone.
 *
 * `--dry-run` for the same reason the clean dialog previews: pruning is administrative
 * bookkeeping right up until it removes the record of a worktree somebody meant to move
 * back, and `-v` is what makes the dry run say anything at all.
 */
export function buildWorktreePruneArgs(options: { dryRun?: boolean } = {}): string[]
{
  const args = [CMD_WORKTREE, SUBCOMMAND_PRUNE];
  if (options.dryRun)
  {
    args.push(FLAG_DRY_RUN);
  }
  args.push(FLAG_VERBOSE);
  return args;
}
