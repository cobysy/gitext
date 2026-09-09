/**
 * The branch argv: creating one, deleting, renaming, and what it tracks. Clearing an
 * orphan's working directory is not a flag, but a second `git rm -r --force .` command
 * after the checkout succeeds, so this exports a plan rather than one argv array.
 */

import type { ArgvStep } from './checkout.js';

const CMD_CHECKOUT = 'checkout';
const CMD_BRANCH = 'branch';
const CMD_RM = 'rm';
const CMD_UPDATE_REF = 'update-ref';
const FLAG_ORPHAN = '--orphan';
const FLAG_NEW_BRANCH = '-b';
const FLAG_RECURSIVE = '-r';
const FLAG_FORCE = '--force';
const FLAG_DELETE = '--delete';
const FLAG_RENAME = '-m';
const FLAG_SET_UPSTREAM_TO = '--set-upstream-to';
const FLAG_UNSET_UPSTREAM = '--unset-upstream';

export interface CreateBranchOptions {
  /** The new branch's name. Trimmed here so the preview shows what will run. */
  name: string;
  /**
   * Where the branch starts: a SHA, a branch, a tag, `HEAD`. Omitted for an orphan in a
   * repository with no commits, where git resolves `checkout --orphan <name>` against an empty index rather than failing.
   */
  startPoint?: string;
  /** Check the new branch out as well as creating it. `checkout -b` rather than `branch`. */
  checkout?: boolean;
  /** An orphan branch: history starts over with no parent commit. Always a checkout, so the dialog forces and disables the checkout box under this option. */
  orphan?: boolean;
  /** Empty the working directory and index after creating the orphan: `checkout --orphan` keeps every file from the old branch, staged. */
  clearWorkingDirectory?: boolean;
}

/** `git branch <name> <start>` / `git checkout -b <name> <start>` / `checkout --orphan …`. */
export function buildCreateBranchArgs(options: CreateBranchOptions): string[]
{
  const { name, startPoint, checkout = false, orphan = false } = options;
  const branchName = name.trim();

  if (orphan)
  {
    const args = [CMD_CHECKOUT, FLAG_ORPHAN, branchName];
    if (startPoint)
    {
      args.push(startPoint);
    }
    return args;
  }

  const args: string[] = [];
  if (checkout)
  {
    args.push(CMD_CHECKOUT, FLAG_NEW_BRANCH);
  }
  else
  {
    args.push(CMD_BRANCH);
  }
  args.push(branchName);
  if (startPoint)
  {
    args.push(startPoint);
  }
  return args;
}

/** `git rm -r --force .`: everything the orphan checkout carried over. */
export function buildClearWorkingDirectoryArgs(): string[]
{
  return [CMD_RM, FLAG_RECURSIVE, FLAG_FORCE, '.'];
}

/**
 * Moving a branch that is **not** checked out. `update-ref`, not `reset`: `git reset`
 * moves only HEAD's own branch, touching the index and working directory with it.
 * `fullRefName` must be the complete ref (`refs/heads/x`): a bare `x` creates a new ref at the top of `.git` instead of moving the branch.
 */
export function buildUpdateRefArgs(fullRefName: string, sha: string): string[]
{
  return [CMD_UPDATE_REF, fullRefName, sha];
}

/**
 * Everything creating a branch runs, in order. Two steps for an orphan being emptied,
 * as a separate command so a failure there reports as "Emptying the working directory failed" rather than the branch not having been created.
 */
export function buildCreateBranchSteps(options: CreateBranchOptions): ArgvStep[]
{
  if (!options.name.trim())
  {
    return [];
  }

  const args = [{ label: 'Creating the branch', argv: buildCreateBranchArgs(options) }];
  if (options.orphan && options.clearWorkingDirectory)
  {
    args.push({
      label: 'Emptying the working directory',
      argv: buildClearWorkingDirectoryArgs()
    });
  }
  return args;
}

/** Deleting local branches: `git branch -d`, or `-D` when not merged. Local only: deleting a remote branch is a push, so it's a different dialog. */
export function buildDeleteBranchArgs(
  names: readonly string[],
  force = false
): string[]
{
  if (names.length === 0)
  {
    return [];
  }
  const args = [CMD_BRANCH, FLAG_DELETE];
  if (force)
  {
    args.push(FLAG_FORCE);
  }
  args.push(...names);
  return args;
}

/** `git branch -m <old> <new>`. */
export function buildRenameBranchArgs(from: string, to: string): string[]
{
  const oldName = from.trim();
  const newName = to.trim();
  if (oldName && newName)
  {
    return [CMD_BRANCH, FLAG_RENAME, oldName, newName];
  }
  else
  {
    return [];
  }
}

/**
 * `git branch --set-upstream-to=<remote>/<branch> <local>`: what a branch tracks. The
 * porcelain spelling, not two `config` calls: git checks the upstream exists, so the
 * dialog can only offer remote-tracking refs this repository already has.
 */
export function buildSetUpstreamArgs(branch: string, upstream: string): string[]
{
  const name = branch.trim();
  const target = upstream.trim();
  if (name && target)
  {
    return [CMD_BRANCH, `${FLAG_SET_UPSTREAM_TO}=${target}`, name];
  }
  else
  {
    return [];
  }
}

/** `git branch --unset-upstream <local>`: the branch stops tracking anything. */
export function buildUnsetUpstreamArgs(branch: string): string[]
{
  const name = branch.trim();
  if (name)
  {
    return [CMD_BRANCH, FLAG_UNSET_UPSTREAM, name];
  }
  else
  {
    return [];
  }
}
