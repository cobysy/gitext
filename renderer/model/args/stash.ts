/**
 * `git stash` argv. Always `push`, never `save` (deprecated since 2.16).
 * `push` requires `-m` for messages and handles both whole-tree and partial stashes.
 */

import { PATH_SEPARATOR } from '@shared/diff.js';

const CMD_STASH = 'stash';
const SUBCOMMAND_PUSH = 'push';
const SUBCOMMAND_POP = 'pop';
const SUBCOMMAND_APPLY = 'apply';
const SUBCOMMAND_DROP = 'drop';
const SUBCOMMAND_SHOW = 'show';
const FLAG_STAGED = '--staged';
const FLAG_INCLUDE_UNTRACKED = '-u';
const FLAG_KEEP_INDEX = '--keep-index';
const FLAG_MESSAGE = '-m';
const FLAG_INDEX = '--index';
const FLAG_PATCH = '-p';
const FLAG_SHOW_UNTRACKED = '--include-untracked';

export interface StashSaveOptions {
  message?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
  paths?: readonly string[];
  /** git 2.35 and later. */
  stagedOnly?: boolean;
}

export function buildStashSaveArgs(options: StashSaveOptions = {}): string[]
{
  const {
    message = '',
    includeUntracked = false,
    keepIndex = false,
    paths = [],
    stagedOnly = false
  } = options;

  const trimmed = message.trim();

  const args = [CMD_STASH, SUBCOMMAND_PUSH];
  if (stagedOnly)
  {
    args.push(FLAG_STAGED);
  }
  // `-u` and `--staged` are mutually exclusive; dialog disables one when the other is chosen.
  if (includeUntracked && !stagedOnly)
  {
    args.push(FLAG_INCLUDE_UNTRACKED);
  }
  if (keepIndex && !stagedOnly)
  {
    args.push(FLAG_KEEP_INDEX);
  }
  if (trimmed)
  {
    args.push(FLAG_MESSAGE, trimmed);
  }
  // `--` is only needed if paths follow (empty -- stashes nothing).
  if (paths.length)
  {
    args.push(PATH_SEPARATOR, ...paths);
  }
  return args;
}

export interface StashApplyOptions {
  ref: string;
  pop?: boolean;
  /**
   * Restore staged as staged (`--index`). Off by default: if the index cannot be reconstructed,
   * git refuses the whole apply rather than falling back.
   */
  restoreIndex?: boolean;
}

export function buildStashApplyArgs(options: StashApplyOptions): string[]
{
  const { ref, pop = false, restoreIndex = false } = options;
  let subcommand: string;
  if (pop)
  {
    subcommand = SUBCOMMAND_POP;
  }
  else
  {
    subcommand = SUBCOMMAND_APPLY;
  }
  const args = [CMD_STASH, subcommand];
  if (restoreIndex)
  {
    args.push(FLAG_INDEX);
  }
  args.push(ref);
  return args;
}

export function buildStashDropArgs(ref: string): string[]
{
  return [CMD_STASH, SUBCOMMAND_DROP, ref];
}

/**
 * `git stash show -p <ref>`. Use `--include-untracked` for stashes created with `-u`
 * (git 2.32+), otherwise fall back to plain form.
 */
export function buildStashShowArgs(ref: string, includeUntracked = false): string[]
{
  const args = [CMD_STASH, SUBCOMMAND_SHOW, FLAG_PATCH];
  if (includeUntracked)
  {
    args.push(FLAG_SHOW_UNTRACKED);
  }
  args.push(ref);
  return args;
}
