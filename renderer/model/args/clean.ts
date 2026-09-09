/**
 * `git clean` argv. Dry-run and force are mutually exclusive; git requires one of them.
 */

import { PATH_SEPARATOR } from '@shared/diff.js';

const MODE_UNTRACKED = 'untracked';
const MODE_IGNORED = 'ignored';
const MODE_ALL = 'all';

const CMD_CLEAN = 'clean';
const CMD_SUBMODULE = 'submodule';
const CMD_GIT = 'git';
const SUBCOMMAND_FOREACH = 'foreach';
const FLAG_RECURSIVE = '--recursive';
const FLAG_IGNORED_ONLY = '-X';
const FLAG_ALL = '-x';
const FLAG_DIRECTORIES = '-d';
const FLAG_DRY_RUN = '--dry-run';
const FLAG_FORCE = '-f';

/** What counts as rubbish. `.gitignore` is the line between the three. */
export type CleanMode = 'untracked' | 'ignored' | 'all';

export interface CleanModeInfo {
  mode: CleanMode;
  /** The flag, or nothing at all: git's default is "untracked and not ignored". */
  flag: string | null;
  label: string;
  detail: string;
}

export const CLEAN_MODES: readonly CleanModeInfo[] = [
  {
    mode: MODE_UNTRACKED,
    flag: null,
    label: 'New files git does not know about',
    detail:
      '`git clean`: untracked files, not ignored ones.'
  },
  {
    mode: MODE_IGNORED,
    flag: FLAG_IGNORED_ONLY,
    label: 'Only ignored files',
    detail:
      '`-X`: ignored files only; new sources are kept.'
  },
  {
    mode: MODE_ALL,
    flag: FLAG_ALL,
    label: 'Everything untracked, ignored or not',
    detail:
      '`-x`: untracked and ignored alike.'
  }
];

export interface CleanOptions {
  mode?: CleanMode;
  /**
   * Show what would go rather than deleting it: `--dry-run`.
   * Dialog must show what's deletable (git has no undo for unknown files).
   */
  dryRun?: boolean;
  /** Delete untracked *directories* too: `-d`. Without it git leaves the folders. */
  directories?: boolean;
  /** Limit to these paths. Empty means the whole working tree. */
  paths?: readonly string[];
  /** Extra patterns to spare: `--exclude=<pattern>`, on top of `.gitignore`. */
  excludes?: readonly string[];
}

/** The flags every clean shares. */
function cleanFlags(options: CleanOptions): string[]
{
  const { mode = MODE_UNTRACKED, dryRun = false, directories = false, excludes = [] } = options;
  const info = CLEAN_MODES.find((entry) => entry.mode === mode);

  const args = [];
  if (info?.flag)
  {
    args.push(info.flag);
  }
  if (directories)
  {
    args.push(FLAG_DIRECTORIES);
  }
  // Dry-run and force are mutually exclusive; git requires one.
  if (dryRun)
  {
    args.push(FLAG_DRY_RUN);
  }
  else
  {
    args.push(FLAG_FORCE);
  }
  args.push(...excludes
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => `--exclude=${pattern}`));
  return args;
}

/** The paths, behind the `--` that says they are paths and not revisions. */
function pathArgs(paths: readonly string[] = []): string[]
{
  const kept = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  if (kept.length)
  {
    return [PATH_SEPARATOR, ...kept];
  }
  else
  {
    return [];
  }
}

export function buildCleanArgs(options: CleanOptions = {}): string[]
{
  return [CMD_CLEAN, ...cleanFlags(options), ...pathArgs(options.paths)];
}

/**
 * Clean in every submodule via `submodule foreach --recursive`.
 * Git clean stops at superproject boundary, so submodules must be cleaned separately.
 */
export function buildCleanSubmodulesArgs(options: CleanOptions = {}): string[]
{
  return [
    CMD_SUBMODULE,
    SUBCOMMAND_FOREACH,
    FLAG_RECURSIVE,
    CMD_GIT,
    CMD_CLEAN,
    ...cleanFlags({ ...options, excludes: [] }),
    ...pathArgs(options.paths)
  ];
}
