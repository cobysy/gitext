/**
 * What the left panel lists: branches, remotes, tags, stashes, worktrees, submodules.
 *
 * Everything here must be structured-clone-safe: it crosses the IPC boundary.
 */

// git's own ref kinds: shared with `CommitRef.kind`, whose wider union also carries 'head'/'stash'/'other'.
export const REF_KIND_BRANCH = 'branch';
export const REF_KIND_REMOTE = 'remote';
export const REF_KIND_TAG = 'tag';

/**
 * A ref as the left panel lists it. One `for-each-ref` produces all three kinds, so
 * they share a type. Annotated tags are peeled: `sha` is always a commit.
 */
export interface RefEntry {
  /** Full ref name (`refs/heads/feature/x`): unique, so it is the node's identity. */
  fullName: string;
  /** Short name: `feature/x`, `origin/main`, `v1.0`. */
  name: string;
  kind: 'branch' | 'remote' | 'tag';
  /** Commit this resolves to; an annotated tag is peeled to the commit it tags. */
  sha: string;
  /** Commit date in unix seconds: what sorting by date orders on. */
  date: number;
  /** True for the branch HEAD is on. */
  isCurrent: boolean;
  /** Short upstream name (`origin/main`), null when there is none. */
  upstream: string | null;
  /** Commits ahead of and behind the upstream; both 0 without one. */
  ahead: number;
  behind: number;
  /** The upstream ref is configured but no longer exists: git calls this "gone". */
  upstreamGone: boolean;
  /** Which remote a `remote` branch belongs to; null for the other kinds. */
  remote: string | null;
  /** A tag object rather than a lightweight tag pointing straight at a commit. */
  isAnnotated: boolean;
}

/**
 * Why a local branch is safe to delete.
 *
 * - `contained`: every commit on it is already an ancestor of the comparison branch;
 *   `git branch -d` accepts it on its own.
 * - `squashed`: its *content* is on the comparison branch as one squashed commit with
 *   no ancestry link, which git's merge test can't see: only `-D` deletes it, the flag with no safety net.
 */
export type StaleBranchReason = 'contained' | 'squashed';

/** A local branch this repository no longer needs, and the evidence for saying so. */
export interface StaleBranch {
  /** Short name: what `git branch -d` is given. */
  name: string;
  reason: StaleBranchReason;
  /** Tip commit, so the dialog can say exactly what would stop being reachable. */
  sha: string;
  /** Tip's commit date in unix seconds. Age is the one signal a reader judges by. */
  date: number;
  /** Whether the branch tracked an upstream that has since been deleted. */
  upstreamGone: boolean;
}

/** The answer to "which branches could I delete", including what was left out: a silent omission is indistinguishable from a miss. */
export interface BranchCleanupReport {
  /** Branches whose work is provably already on the comparison branch. */
  stale: StaleBranch[];
  /** How many local branches were examined, offered or not. */
  examined: number;
  /** Names deliberately not offered, each with why: current, worktree, or unmerged. */
  keptBack: { name: string; why: string }[];
}

/** A configured remote. Fetch and push URLs are separate in git and here. */
export interface RemoteEntry {
  name: string;
  fetchUrl: string;
  /** `remote.<name>.pushurl`, falling back to the fetch URL as git itself does. */
  pushUrl: string;
  /**
   * Deactivated: its config section is spelled `-remote.<name>.*`, so git ignores it,
   * keeping it out of every fetch without deleting its URL. Not a git feature: nothing outside this app shows it while off.
   */
  disabled: boolean;
}

export interface StashEntry {
  /** Position in the stash stack; 0 is the most recent. */
  index: number;
  /** Selector git accepts, e.g. `stash@{0}`. Not stable across drops: `sha` is. */
  name: string;
  sha: string;
  date: number;
  /** The reflog subject, e.g. `WIP on main: 01419fc some message`. */
  message: string;
  /** Branch the stash was taken on, parsed out of `message`; null if unrecognised. */
  branch: string | null;
}

export interface WorktreeEntry {
  /** Absolute path to the worktree root. */
  path: string;
  /** Checked-out commit; empty in a worktree with an unborn HEAD. */
  head: string;
  /** Short branch name, or null when the worktree is detached or bare. */
  branch: string | null;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  /** Reason given to `git worktree lock`, empty when locked without one. */
  lockReason: string;
  /** git considers this worktree removable by `git worktree prune`. */
  prunable: boolean;
  /** The repository's own working tree, which is always listed first and cannot be removed. */
  isMain: boolean;
}

/**
 * What `git submodule status` says about one submodule, which `.gitmodules` can't. Its
 * own read, not a field on `SubmoduleEntry`: it walks into every submodule and is slow
 * enough to skip on a watcher tick.
 */
export const SUBMODULE_STATE_CURRENT = 'current' as const;
export const SUBMODULE_STATE_UNINITIALIZED = 'uninitialized' as const;
export const SUBMODULE_STATE_DIFFERENT_COMMIT = 'different-commit' as const;
export const SUBMODULE_STATE_CONFLICTED = 'conflicted' as const;

export interface SubmoduleStatusEntry {
  path: string;
  /** The commit the superproject records for it. */
  sha: string;
  /** git's own `(v1.2-3-gabc)` annotation, empty when it had none to give. */
  described: string;
  state:
    | typeof SUBMODULE_STATE_CURRENT
    | typeof SUBMODULE_STATE_UNINITIALIZED
    | typeof SUBMODULE_STATE_DIFFERENT_COMMIT
    | typeof SUBMODULE_STATE_CONFLICTED;
}

export interface SubmoduleEntry {
  /** Name from `.gitmodules`, which is not always the path. */
  name: string;
  path: string;
  url: string;
  /** `submodule.<name>.branch`, null when the submodule tracks a fixed commit. */
  branch: string | null;
  /** False until `git submodule init`/`update` has populated the working tree. */
  initialized: boolean;
}
