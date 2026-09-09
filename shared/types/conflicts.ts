/**
 * One conflicted file, at every point of view a 3-way merge has.
 *
 * Everything here must be structured-clone-safe: it crosses the IPC boundary.
 */

/**
 * Three blobs in a merge conflict plus working tree version.
 * Null fields represent missing sides (add/add has no base, delete/modify has no copy).
 */
export interface ConflictBlobs {
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** Working-tree file with conflict markers (for a clean merge). */
  working: string;
}

/** One side of the conflict, as something a person can name rather than an index stage. */
export interface ConflictSideRef {
  /**
   * The commit SHA, or null for a patch in `git am` (not a commit yet).
   */
  sha: string | null;
  /** Branch name (or short SHA, or patch subject line). */
  name: string;
  /**
   * Author name for a side with no commit (when `sha` is null). Blaming is better for commits.
   */
  author?: string;
  /** Unix seconds, alongside `author`. */
  authorTime?: number;
}

/**
 * Which commits "ours" and "theirs" are in the current operation.
 * Either can be null: `am` has no ref, and no operation in progress has neither.
 */
export interface ConflictSides {
  ours: ConflictSideRef | null;
  theirs: ConflictSideRef | null;
}
