/**
 * Identity and state of an open repository.
 * Must be structured-clone-safe: crosses IPC boundary.
 */
export interface RepoInfo {
  /** Absolute path to the working tree root. */
  path: string;
  /** Basename of `path`, for display. */
  name: string;
  /** Absolute path to the `.git` directory (differs for worktrees and submodules). */
  gitDir: string;
  /** Current branch name, or null when HEAD is detached. */
  branch: string | null;
  /**
   * Full SHA of HEAD, or null in an unborn repository.
   *
   * Full rather than short because the artificial rows parent onto it and the grid
   * matches parents against the log's full SHAs. Display sites shorten it.
   */
  head: string | null;
  isBare: boolean;
  /** Working-tree root of the superproject, when this repo is a submodule. */
  superprojectPath: string | null;
}

export const OPERATION_NONE = 'none' as const;
export const OPERATION_MERGE = 'merge' as const;
export const OPERATION_REBASE = 'rebase' as const;
export const OPERATION_CHERRY_PICK = 'cherry-pick' as const;
export const OPERATION_REVERT = 'revert' as const;
export const OPERATION_BISECT = 'bisect' as const;
export const OPERATION_AM = 'am' as const;

/** An operation git is part-way through, as inferred from `.git` marker files. */
export type InProgressOperation =
  | typeof OPERATION_NONE
  | typeof OPERATION_MERGE
  | typeof OPERATION_REBASE
  | typeof OPERATION_CHERRY_PICK
  | typeof OPERATION_REVERT
  | typeof OPERATION_BISECT
  | typeof OPERATION_AM;

/**
 * Everything the UI needs to decide what to offer after a mutating command.
 * Consumed by the `afterGitOperation` hook.
 */
export interface RepoState {
  operation: InProgressOperation;
  conflictCount: number;
  conflictedPaths: string[];
}
