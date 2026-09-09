/**
 * Objects git holds but nothing points at (git fsck).
 * Structured-clone-safe: crosses IPC.
 */

export const STATE_DANGLING = 'dangling';
export const STATE_UNREACHABLE = 'unreachable';
export const STATE_MISSING = 'missing';

/** What fsck said about an object's reachability. */
export type LostObjectState = typeof STATE_DANGLING | typeof STATE_UNREACHABLE | typeof STATE_MISSING;

// git's object kinds: shared with for-each-ref, FileStatusCode, TreeEntry.kind.
export const OBJECT_KIND_COMMIT = 'commit' as const;
export const OBJECT_KIND_BLOB = 'blob' as const;
export const OBJECT_KIND_TREE = 'tree' as const;
export const OBJECT_KIND_TAG = 'tag' as const;

/** Not one of git's own object kinds: a tree entry that names a submodule commit. */
export const OBJECT_KIND_SUBMODULE = 'submodule' as const;

/** The four kinds of object git stores. */
export type LostObjectKind =
  | typeof OBJECT_KIND_COMMIT
  | typeof OBJECT_KIND_BLOB
  | typeof OBJECT_KIND_TREE
  | typeof OBJECT_KIND_TAG;

/**
 * One object fsck found, with whatever could be said about it.
 *
 * The metadata fields are filled in for commits only, and only when git could describe
 * them: a blob has no author and a `missing` object has nothing at all, since the whole
 * complaint is that it is not there. They are optional rather than empty strings so a row
 * can show what it knows and say nothing where it knows nothing: an empty author column
 * on a blob would read as an object by nobody.
 */
export interface LostObject {
  state: LostObjectState;
  kind: LostObjectKind;
  sha: string;
  /** Commits and tags only: the first line of the message. */
  subject?: string;
  author?: string;
  /** Commit date, as a Unix timestamp in seconds: the field the list sorts on. */
  date?: number;
  /** The commit's parents, if it has any. A root commit has none; a blob has no concept. */
  parents?: string[];
}
