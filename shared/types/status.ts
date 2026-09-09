/**
 * Working tree status per file. Must be structured-clone-safe (crosses IPC boundary).
 */

export const FILE_STATUS_UNCHANGED = 'unchanged' as const;
export const FILE_STATUS_ADDED = 'added';
export const FILE_STATUS_MODIFIED = 'modified';
export const FILE_STATUS_DELETED = 'deleted';
export const FILE_STATUS_RENAMED = 'renamed';
export const FILE_STATUS_COPIED = 'copied';
export const FILE_STATUS_UNTRACKED = 'untracked';
export const FILE_STATUS_IGNORED = 'ignored';
export const FILE_STATUS_CONFLICTED = 'conflicted';
export const FILE_STATUS_TYPECHANGE = 'typechange';
export const FILE_STATUS_UNKNOWN = 'unknown';

export type FileStatusCode =
  /**
   * Not a change at all: a file that exists at a revision.
   *
   * Only the file tree produces this. It is here rather than as a separate type because
   * the file commands ask a selected file one question, what kind of change is it?, and
   * "none, it is just a file" is an answer they have to be able to get. Git never prints
   * it; no parser produces it.
   */
  | typeof FILE_STATUS_UNCHANGED
  | typeof FILE_STATUS_ADDED
  | typeof FILE_STATUS_MODIFIED
  | typeof FILE_STATUS_DELETED
  | typeof FILE_STATUS_RENAMED
  | typeof FILE_STATUS_COPIED
  | typeof FILE_STATUS_UNTRACKED
  | typeof FILE_STATUS_IGNORED
  | typeof FILE_STATUS_CONFLICTED
  | typeof FILE_STATUS_TYPECHANGE
  | typeof FILE_STATUS_UNKNOWN;

export interface FileStatus {
  path: string;
  /** Set only for renames and copies. */
  origPath?: string;
  index: FileStatusCode;
  worktree: FileStatusCode;
  staged: boolean;
  unstaged: boolean;
  isSubmodule: boolean;
}

export interface WorkingTreeStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileStatus[];
}

/**
 * Which of git's two ignore files a rule goes in.
 *
 * The difference is who else sees it: `.gitignore` is committed and ignores the path for
 * everybody, `.git/info/exclude` is never committed and ignores it for you. Both questions
 * get asked, and answering the second with the first is how a personal scratch file ends
 * up in someone else's ignore rules.
 */
export type IgnoreTarget = 'gitignore' | 'exclude';

/**
 * A repository file the app opens as plain text.
 *
 * A superset of `IgnoreTarget` rather than a widening of it: adding a rule to an ignore
 * file and editing a file wholesale are different operations with different dialogs, and
 * `file:addIgnoreRules` has no meaning for `.gitattributes` or `config`.
 */
export type RepoTextFile = IgnoreTarget | 'gitattributes' | 'config';
