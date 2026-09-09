/**
 * `git submodule` argv. `submodule add [-f] [-b <branch>] <url> <path>`. `--init
 * --recursive` on update is not optional in practice: without `--init` an `update`
 * silently does nothing for a submodule never checked out, the one you're most likely updating.
 */

import { PATH_SEPARATOR } from '@shared/diff.js';

const CMD_SUBMODULE = 'submodule';
const CMD_RM = 'rm';
const SUBCOMMAND_ADD = 'add';
const SUBCOMMAND_UPDATE = 'update';
const SUBCOMMAND_SYNC = 'sync';
const SUBCOMMAND_DEINIT = 'deinit';
const SUBCOMMAND_SUMMARY = 'summary';
const FLAG_CACHED = '--cached';
const FLAG_FORCE = '-f';
const FLAG_FORCE_LONG = '--force';
const FLAG_BRANCH = '-b';
const FLAG_INIT = '--init';
const FLAG_RECURSIVE = '--recursive';
const FLAG_REMOTE = '--remote';

export interface AddSubmoduleOptions {
  /** Where the submodule is cloned from. */
  url: string;
  /** Where it goes inside this repository, relative to its root. */
  path: string;
  /** Track a branch rather than a fixed commit: `-b <branch>`. */
  branch?: string;
  /** Add it even where git would refuse: an existing path, an ignored one, `-f`. */
  force?: boolean;
}

export function buildAddSubmoduleArgs(options: AddSubmoduleOptions): string[]
{
  const { url, path, branch = '', force = false } = options;
  const remote = url.trim();
  const local = path.trim();
  if (!remote || !local)
  {
    return [];
  }

  const args = [CMD_SUBMODULE, SUBCOMMAND_ADD];
  if (force)
  {
    args.push(FLAG_FORCE);
  }
  if (branch.trim())
  {
    args.push(FLAG_BRANCH, branch.trim());
  }
  args.push(remote);
  // POSIX separators: git stores this path in `.gitmodules`, committed and read on every platform.
  args.push(local.replace(/\\/g, '/'));
  return args;
}

export interface UpdateSubmoduleOptions {
  /** One submodule's path, or empty for all of them. */
  path?: string;
  /** Clone the ones that have never been checked out: `--init`. */
  init?: boolean;
  /** Walk into submodules of submodules: `--recursive`. */
  recursive?: boolean;
  /** Take the remote's branch head rather than the commit the superproject records: `--remote`. Only meaningful with `submodule.<name>.branch` set. */
  remote?: boolean;
  /** Overwrite local changes in the submodule's working tree: `--force`. */
  force?: boolean;
}

export function buildUpdateSubmoduleArgs(options: UpdateSubmoduleOptions = {}): string[]
{
  const { path = '', init = true, recursive = true, remote = false, force = false } = options;

  const args = [CMD_SUBMODULE, SUBCOMMAND_UPDATE];
  if (init)
  {
    args.push(FLAG_INIT);
  }
  if (recursive)
  {
    args.push(FLAG_RECURSIVE);
  }
  if (remote)
  {
    args.push(FLAG_REMOTE);
  }
  if (force)
  {
    args.push(FLAG_FORCE_LONG);
  }
  // Behind `--`, so a submodule directory named like an option is still a path.
  if (path.trim())
  {
    args.push(PATH_SEPARATOR, path.trim());
  }
  return args;
}

/**
 * `git submodule sync`: copy the URLs from `.gitmodules` into `.git/config`. What you
 * run when somebody changed a submodule's URL upstream: `.gitmodules` arrives with a
 * pull, but the URL git actually clones from lives in local config and isn't updated by one.
 */
export function buildSyncSubmodulesArgs(
  options: { path?: string; recursive?: boolean } = {}
): string[]
{
  const { path = '', recursive = true } = options;
  const args = [CMD_SUBMODULE, SUBCOMMAND_SYNC];
  if (recursive)
  {
    args.push(FLAG_RECURSIVE);
  }
  if (path.trim())
  {
    args.push(PATH_SEPARATOR, path.trim());
  }
  return args;
}

/**
 * Removing a submodule, which git has no single command for. Two steps: `deinit -f`
 * empties the working tree and drops local config, `rm` takes it out of the index and
 * `.gitmodules`. `.git/modules/<name>` is left behind by both (git keeps it so re-adding
 * is cheap) and deliberately not deleted here: that's a filesystem operation, not a git
 * command, and a dialog previewing an argv shouldn't quietly do something no argv describes.
 */
export function buildRemoveSubmoduleSteps(
  path: string
): { label: string; argv: string[] }[]
{
  const target = path.trim();
  if (!target)
  {
    return [];
  }

  return [
    {
      label: `Emptying ${target}`,
      argv: [CMD_SUBMODULE, SUBCOMMAND_DEINIT, FLAG_FORCE, PATH_SEPARATOR, target]
    },
    {
      label: `Removing ${target} from the index and .gitmodules`,
      argv: [CMD_RM, FLAG_FORCE, PATH_SEPARATOR, target]
    }
  ];
}

/**
 * `git submodule summary`: what each submodule moved past, in prose. `--cached`
 * matters: without it git compares against the *working tree*, but the point of running
 * this from the commit screen is to describe what's about to be committed, i.e. the index.
 */
export function buildSubmoduleSummaryArgs(path = ''): string[]
{
  const target = path.trim();
  const args = [CMD_SUBMODULE, SUBCOMMAND_SUMMARY, FLAG_CACHED];
  if (target)
  {
    args.push(PATH_SEPARATOR, target);
  }
  return args;
}
