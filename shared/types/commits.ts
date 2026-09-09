/**
 * Commits, as the revision grid and the details pane see them: rows, refs, signatures,
 * the streaming log read, and the options that shape what gets walked.
 *
 * Everything here must be structured-clone-safe: it crosses the IPC boundary.
 */

// The two decoration kinds only a commit's refs have: `head` is git's bare `HEAD`
// when detached, `stash` is `refs/stash`. The other three live in `types/refs.ts`.
export const REF_KIND_HEAD = 'head';
export const REF_KIND_STASH = 'stash';

/** A ref pointing at a commit, as decoded from `%D`. */
export interface CommitRef {
  name: string;
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash' | 'other';
  /** True for the ref HEAD currently points at. */
  isCurrent: boolean;
}

/** One row of the revision grid. */
export interface CommitRow {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Unix seconds. Formatting is the renderer's business. */
  authorDate: number;
  committerName: string;
  committerEmail: string;
  committerDate: number;
  subject: string;
  /** Message after the subject, empty when there is none. */
  body: string;
  refs: CommitRef[];
  /** Attached git note, empty unless the log was asked for notes. */
  note: string;
}

/**
 * One commit, named well enough to say what you're looking at: compare dialog slot
 * cards, and anything resolving a typed revision. Not `CommitRow`: carries the
 * *resolved* `sha` beside the name asked for, since a branch is a moving target.
 */
export interface CommitSummary {
  /** The full SHA the revision resolved to. */
  sha: string;
  subject: string;
  authorName: string;
  /** Unix seconds. Formatting is the renderer's business. */
  authorDate: number;
}

/**
 * A row the grid shows that is not a commit: the working tree and the index. They sit
 * above HEAD and diff against it.
 */
export type ArtificialRowKind = 'workingTree' | 'index';

/**
 * What a revision is, in one line, for a dialog handed one: a dialog window has no
 * grid to look it up in, and forty hex characters confirms nothing. Annotated tags are peeled.
 */
export interface RevisionSummary {
  sha: string;
  /** As git abbreviates it: the length this repository needs to be unambiguous. */
  shortSha: string;
  subject: string;
  author: string;
  /** Commit date, unix seconds. */
  date: number;
}

/**
 * What the details pane needs beyond the row the grid already has: the one thing that
 * costs an extra git call per commit and so is fetched on selection.
 */
export interface CommitDetails {
  sha: string;
  /** Attached git note, empty when there is none. */
  note: string;
}

/**
 * Everything the View menu can change about which commits are listed and in what
 * order. Defaults: current branch scope, date order.
 */
export interface LogOptions {
  /** Max commits, or null for the whole history. */
  limit?: number | null;
  /** Which refs to walk. `all` includes remotes and tags; `current` follows HEAD. */
  scope?: 'current' | 'all' | 'filtered';
  /** Refs to walk when `scope` is `filtered`. */
  refs?: string[];
  /**
   * `date` interleaves branches by commit date, `topo` keeps each branch contiguous,
   * `author-date` sorts by when work was written rather than committed.
   */
  order?: 'date' | 'topo' | 'author-date';
  /** Include reflog entries, so recently-visited commits appear even if unreferenced. */
  reflog?: boolean;
  /** Follow only the first parent, collapsing merged branches out of the view. */
  firstParentOnly?: boolean;
  /** Attach git notes. Off by default: it costs an extra object lookup per commit. */
  notes?: boolean;
  /** Limit to commits touching these paths. */
  paths?: string[];
  /**
   * Follow a file's history across renames (`git log --follow`). git only honors it
   * with exactly one path; `buildLogArgs` throws if `paths` doesn't hold exactly one.
   */
  follow?: boolean;
  /** Free-text filters, applied by git rather than by us. */
  messageFilter?: string;
  authorFilter?: string;
  committerFilter?: string;
  /** Commits whose diff adds or removes this text (`git log -S`). */
  diffContentFilter?: string;
  /** Treat the text filters as regular expressions rather than fixed strings. */
  useRegex?: boolean;
  ignoreCase?: boolean;
  since?: string;
  until?: string;
  /** Drop merge commits from the walk (`git log --no-merges`). */
  hideMergeCommits?: boolean;
  /**
   * Whether the `all` scope's walk includes tags / remote-tracking branches. Only
   * meaningful when `scope` is `all`. Both default to included: every ref badge the grid draws is unconditional today.
   */
  includeTags?: boolean;
  includeRemoteBranches?: boolean;
  /**
   * Add the most recent stash to the walk, independent of `scope`: none of the three
   * reach `refs/stash` on their own. Purely additive: off changes nothing, on adds the
   * one ref on top of whatever scope already walks.
   */
  includeStashes?: boolean;
}

/**
 * One instalment of a streaming log read. Batches are coalesced in main before
 * crossing IPC: git hands back roughly three commits per chunk, so forwarding each costs more than parsing the whole history did.
 */
export interface LogBatch {
  /** Identifies which request this belongs to; a stale stream's batches are dropped. */
  requestId: number;
  commits: CommitRow[];
  /** True on the final batch, whether it succeeded or failed. */
  done: boolean;
  /** Set when the read failed; `commits` is then whatever arrived first. */
  error?: string;
}

/**
 * Git's own name for each message file this app reads or writes.
 *
 * Named rather than free-form because these are git's files, not ours: `git merge` reads
 * `MERGE_MSG` when composing a merge commit, `git tag` uses `TAG_EDITMSG`, and a commit
 * in progress is in `COMMIT_EDITMSG`. Here rather than in `main/git/commit.ts` because
 * both sides of the boundary name one: `shared/contract.ts` types two channels with it.
 */
export const MERGE_MSG_FILE = 'MERGE_MSG' as const;
export const TAG_EDITMSG_FILE = 'TAG_EDITMSG' as const;
export const COMMIT_EDITMSG_FILE = 'COMMIT_EDITMSG' as const;
export type MessageFileName = typeof MERGE_MSG_FILE | typeof TAG_EDITMSG_FILE | typeof COMMIT_EDITMSG_FILE;
