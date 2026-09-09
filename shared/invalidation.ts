/**
 * What a git operation touched: the facets of a repository it invalidates. This is how
 * a window learns the repository moved the moment the command exits, rather than when
 * chokidar notices `.git` change ~450ms later. A facet set is declared, never inferred:
 * `git:run` takes one as a required argument, so the caller that built the argv says
 * what it invalidates. Main says what changed; the renderer decides what to reload: see
 * `renderer/composables/useRepoInvalidation.ts`.
 */

/** One kind of thing an operation can invalidate. About the *repository*, not the UI: `'refs'` means branches and tags moved, not "reload the left panel". */
export type RepoFacet =
  /** Which commit or branch is checked out. */
  | 'head'
  /** Local or remote branches and tags created, deleted or moved. */
  | 'refs'
  /** The set of commits a log query would return. */
  | 'commits'
  /** Tracked or untracked files on disk. */
  | 'worktree'
  /** The staging area. */
  | 'index'
  | 'stashes'
  | 'remotes'
  | 'submodules'
  | 'worktrees'
  /** git config, which is also where remotes live. */
  | 'config';

/** Everything, for the caller that has to be conservative: the `.git` watcher, which knows only that *something* moved, not what. */
export const ALL_FACETS: readonly RepoFacet[] = [
  'head',
  'refs',
  'commits',
  'worktree',
  'index',
  'stashes',
  'remotes',
  'submodules',
  'worktrees',
  'config'
];

/**
 * A read: it changed nothing. Not every `git:run` is a mutation: a `rev-parse
 * --is-shallow-repository` or a `clean --dry-run` preview goes through the same channel.
 * Naming it makes those calls say so, and it's what tells the runner to take no `index.lock`.
 */
export const READS: readonly RepoFacet[] = [];

/**
 * A command that moves the branch you're on and rewrites both trees to match. `commit`,
 * `merge`, `rebase`, `reset`, `cherry-pick`, `revert` and `am` all do this; shared so those dialogs can't drift on which five facets they list.
 */
export const HISTORY_MOVE: readonly RepoFacet[] = [
  'head',
  'commits',
  'refs',
  'worktree',
  'index'
];

/** Checking something out: HEAD moves and the working tree is rewritten to match. */
export const CHECKOUT: readonly RepoFacet[] = ['head', 'worktree'];

/** A checkout that stashed local changes first: adds a stash entry and touches the index. */
export const CHECKOUT_WITH_STASH: readonly RepoFacet[] = [...CHECKOUT, 'stashes', 'index'];

/** Restoring paths: `checkout -- <path>`, `clean`, a patch applied to the tree. */
export const WORKING_TREE: readonly RepoFacet[] = ['worktree'];

/** Staging and unstaging. */
export const STAGING: readonly RepoFacet[] = ['index'];

/** Creating, deleting, renaming or moving a branch or tag. */
export const REFS: readonly RepoFacet[] = ['refs'];
