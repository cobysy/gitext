/**
 * Persisted app settings, and their defaults.
 *
 * Everything here must be structured-clone-safe: it crosses the IPC boundary.
 */

export const THEME_SYSTEM = 'system' as const;
export const THEME_LIGHT = 'light' as const;
export const THEME_DARK = 'dark' as const;
export type ThemePreference = typeof THEME_SYSTEM | typeof THEME_LIGHT | typeof THEME_DARK;
export type DateFormat = 'relative' | 'absolute';
/** Which side of the revision grid the commit info sits on. */
export type CommitInfoPosition = 'left' | 'right';
/** Stroke weight of a graph lane line; see `Settings.graphLineWidth`. */
export type GraphLineWidth = 'light' | 'normal' | 'heavy';

/** How much of a row off the current branch is drawn dimmed; see `Settings.graphDimNonRelatives`. */
export const GRAPH_DIM_NONE = 'none' as const;
export const GRAPH_DIM_LANES = 'lanes' as const;
export const GRAPH_DIM_ALL = 'all' as const;
export type GraphDimming =
  | typeof GRAPH_DIM_NONE
  | typeof GRAPH_DIM_LANES
  | typeof GRAPH_DIM_ALL;

export interface Settings {
  theme: ThemePreference;
  dateFormat: DateFormat;
  /** Absolute path to the git binary, or null to auto-detect. */
  gitPath: string | null;
  /**
   * Which app "Open Terminal Here" hands the repo to (`open -a` name), or null for the
   * built-in default (iTerm2 if installed, else Terminal): as personal a choice as an editor.
   */
  terminalApp: string | null;
  /** Max entries retained in the command log ring buffer. */
  commandLogDepth: number;
  /**
   * Strip identity out of a saved diagnostics report: the home path, the credentials in
   * a remote URL, and the body of a commit message. Off, because the log the app keeps
   * is the log it shows, and a report is far more use whole. See `main/diagnostics/redact.ts`.
   */
  redactDiagnostics: boolean;
  /** Most-recently-opened repositories, newest first. */
  recentRepos: string[];
  /** Max commits loaded into the revision grid; null means no limit. */
  commitLoadLimit: number | null;
  /**
   * Which refs the grid walks: everything, only the checked-out branch's history, or
   * branches matching `branchFilter`. The View menu's branch-scope selector.
   */
  branchScope: 'all' | 'current' | 'filtered';
  /**
   * The pattern `filtered` scope walks (branch names and/or `*`/`?`/`[...]`). Persisted,
   * unlike the rest of the Advanced Filter dialog: an empty pattern resets on restart.
   */
  branchFilter: string;
  /**
   * Whether `all`/`filtered` scopes include remote-tracking branches, tags, the latest
   * stash. All default true: the grid's ref badges were unconditional before this existed.
   */
  logShowRemoteBranches: boolean;
  logShowTags: boolean;
  logShowStashes: boolean;
  /** Walk the reflog instead of the branch scope. Off: a recovery tool, not an everyday view. */
  logShowReflog: boolean;
  /**
   * Whether a toolbar button carries its label beside the glyph, or the glyph alone.
   * All or none: a row where three buttons are named and seven are not reads as seven
   * buttons somebody forgot.
   */
  toolbarLabels: 'all' | 'none';
  /**
   * Which of the four optional panes are showing. Persisted, not session state: closing a
   * pane is a decision about how you work, adopted by a second window via `event:settings`.
   */
  showLeftPanel: boolean;
  /** The Commit pane beside the grid: what the selected row *is*. */
  showCommitDetails: boolean;
  /** The band under the grid: what the selected row *changed*, and the change itself. */
  showFilePane: boolean;
  showCommandLog: boolean;
  /** Show the working-tree and index rows above HEAD. On by default. */
  showArtificialCommits: boolean;
  /**
   * How much of a row outside the checked-out branch is drawn flat grey. A ladder, not two
   * switches: `'lanes'` (default) marks the branch while text stays readable; `'all'` mutes it too.
   */
  graphDimNonRelatives: GraphDimming;
  /**
   * Let a merge's incoming line join a column already heading for the same commit,
   * instead of taking a column of its own and running beside it until they meet.
   */
  graphMergeCommonParentLanes: boolean;
  /**
   * Lane stroke width in CSS px: light 1, normal 2, heavy 3. Rendering-only, not part of
   * `GraphConfig`: it changes nothing about which lane a line is in.
   */
  graphLineWidth: GraphLineWidth;
  /**
   * How long the grid's quick-search term stays on screen after the last keystroke, in ms:
   * long enough to finish a word, short enough that the next keystroke reads as a new search.
   */
  quickSearchTimeout: number;
  /**
   * Revision-grid column order, widths, visibility. Stored as written, reconciled against
   * this build's columns on read (`renderer/columns.ts`); typed loosely since old values arrive stale.
   */
  gridColumns: unknown;
  /** Width of the left panel in pixels. */
  leftPanelWidth: number;
  /** Left-panel section order and visibility; reconciled on read, same reason as `gridColumns`. */
  leftPanelSections: unknown;
  /** Sort refs within a section by name or by commit date. */
  leftPanelSort: 'name' | 'date';
  leftPanelSortAscending: boolean;
  /**
   * Which question the file pane answers: what the row *changed*, or what the repository
   * *contains* there. One pane with a mode, since both are the same paths in the same folders.
   */
  filesPaneMode: 'changed' | 'tree';
  /**
   * What the pane beside the list shows: the diff, or the file whole. Independent of
   * `filesPaneMode`; not every combination has an answer (a tree file untouched has no diff).
   */
  filePaneView: 'diff' | 'file';
  /**
   * Which side of the grid the commit info sits on, never below: it's the grid's
   * companion, exactly as tall. Files and diff stay in the pane below, full width.
   */
  commitInfoPosition: CommitInfoPosition;
  /**
   * Changed-files list shape: flat, folded into folders, or grouped by extension/status.
   * Same four shapes as `stagingListView`, so neither list answers a question the other can't.
   */
  fileListView: 'flat' | 'tree' | 'extension' | 'status';
  /** Merge a folder holding nothing but one other folder into a single row. */
  fileListDenseTree: boolean;
  /**
   * List files git is ignoring, alongside working-tree changes. Off by default and asked
   * per read: `--ignored` on a repo with `node_modules` is thousands of rows.
   */
  fileListShowIgnored: boolean;
  /** Author column: show initials (e.g. "JD") instead of the full name. */
  authorInitials: boolean;
  /**
   * Follow a row's subject with the rest of its message, dimmed, on the same line: a grid
   * whose row height changes with the commit can't be read down. Blank lines drop, paragraphs join.
   */
  showMessageBody: boolean;
  /**
   * Which of a commit's two dates the Date column shows: on is author date (when
   * written), off is committer date (moved by rebase/amend). One column; the tooltip names both when they differ.
   */
  showAuthorDate: boolean;
  /** Diff viewer: one column with the changes marked, or old and new side by side. */
  diffViewMode: 'inline' | 'sideBySide';
  /** Which whitespace differences the diff hides (`-b` and `-w`). */
  diffIgnoreWhitespace: 'none' | 'change' | 'all';
  /** Unchanged lines shown around each change: git's `--unified`. */
  diffContextLines: number;
  /**
   * Show the file entire, not windowed around each change. Still `--unified`, with a
   * count no file reaches (`WHOLE_FILE_CONTEXT`), so it overrides `diffContextLines` without replacing it.
   */
  diffWholeFile: boolean;
  /**
   * Where each dialog window was left, keyed by `DialogName`. An absent key means
   * "centred", not a default coordinate; reconciled on read so an unplugged display can't restore off-screen.
   */
  dialogBounds: unknown;
  /** Confirmations ticked "don't ask again", keyed by their key. See `shared/confirmations.ts`. */
  confirmSuppressions: unknown;
  /**
   * Whether dialogs may ask how far a ref is from HEAD. On by default; worth disabling on
   * a very large repo, where the walk is expensive. The dirty-tree check is unaffected, it's free.
   */
  repoFactsInDialogs: boolean;
  /**
   * Show a dialog's git output live, in a console window of its own, instead of only
   * its final success or failure. Off by default: the command log (`showCommandLog`)
   * is already there for whoever wants to see what ran. `repo.gc` opens the console
   * whatever this says: watching it work is the whole reason that dialog exists.
   */
  streamLiveOutput: boolean;
  /**
   * Close the console by itself once the command succeeds. A failed command's console
   * always stays: that is when its output is worth reading.
   */
  commandOutputAutoClose: boolean;
  /** How long a successful console stays up first, in seconds. */
  commandOutputAutoCloseSeconds: number;
  /**
   * What a checkout does with uncommitted changes in the way, remembered from the checkout
   * dialog's "Set as default". `'stash'` is `stash push` plus an offer to pop; the rest are `--merge`, `--force`, or nothing.
   */
  checkoutLocalChanges: 'none' | 'merge' | 'stash' | 'reset';
  /**
   * Apply that choice without opening the dialog. Off: a dirty tree is what opens the
   * dialog at all. On: the remembered choice answers it, even on a clean tree.
   */
  checkoutUseDefaultLocalChanges: boolean;
  /**
   * Open the checkout dialog even with nothing to ask. Off: a clean checkout runs with no
   * window, which is what makes the click feel instant.
   */
  checkoutAlwaysShowDialog: boolean;
  /**
   * Include untracked files when a dialog auto-stashes: `stash push -u`. Off: an
   * untracked file rarely collides with a checkout, and nobody wants build output swept into a stash.
   */
  autoStashUntracked: boolean;
  /**
   * Tidy a typed branch name into one git accepts, on blur. On: git's rejection names
   * none of the rules broken. Normalising isn't validating: `repo:validBranchName` still asks git.
   */
  normaliseBranchNames: boolean;
  /** What an invalid character becomes. `'_'` by default; `''` deletes it instead. */
  normaliseBranchSymbol: string;
  /** Check a branch out after moving it with Reset Another Branch: usually why you moved it. */
  checkoutAfterResetOtherBranch: boolean;
  /**
   * Merge with `--no-ff`, always recording a merge commit. Off, git's own default. A
   * radio, not a checkbox: "keep one line of history" and "always record the merge" are different intents.
   */
  mergeNoFastForward: boolean;
  /** Stop before committing the merge. Off. */
  mergeNoCommit: boolean;
  /** Summarize the merged commits in the message: `--log`. */
  mergeAddLogMessages: boolean;
  /** How many, when it does. */
  mergeLogMessageCount: number;
  /**
   * Let git stash and reapply around a rebase: `--autostash`. Off; unlike the checkout
   * dialog's Stash, git does this round trip itself, so it's a flag here and a plan there.
   */
  rebaseAutostash: boolean;
  /**
   * Sweep untracked files into a stash from the stash dialog: `-u`. On, unlike the
   * automatic checkout stash: this one is deliberate.
   */
  stashIncludeUntracked: boolean;
  /** Put the staged half back after stashing: `--keep-index`. Off. */
  stashKeepIndex: boolean;
  /** A cherry-pick makes the commit itself rather than leaving it staged. On. */
  cherryPickAutoCommit: boolean;
  /**
   * Write "(cherry picked from commit …)" into the message: `-x`. Off: it names a SHA
   * meaning nothing outside a repo with the original. Reverting persists neither cherry-pick setting.
   */
  cherryPickAddReference: boolean;
  /** What a pull does with what it fetched, remembered from the dialog. Merge by default. */
  pullAction: 'merge' | 'rebase' | 'fetch';
  /** Stash before pulling, offer it back after: this app's round trip, not git's `--autostash`. */
  pullAutostash: boolean;
  /**
   * The commit screen's three splitters, in px: file-list width, staged-list and
   * message-box heights. Persisted: the right proportions are a habit, not something worth re-dragging every open.
   */
  commitListsWidth: number;
  commitStagedHeight: number;
  commitMessageHeight: number;
  /**
   * How the commit screen's two lists are shaped, and how dense a tree is. Their own
   * settings, not the file pane's: a different list answering a different question.
   */
  stagingListView: 'flat' | 'tree' | 'extension' | 'status';
  stagingDenseTree: boolean;
  /**
   * What the unstaged list shows beyond ordinary changes. `showUntracked` off is
   * `--untracked-files=no`; the other three surface files marked as unchanged, the only way to find one again.
   */
  stagingShowUntracked: boolean;
  stagingShowIgnored: boolean;
  stagingShowSkipWorktree: boolean;
  stagingShowAssumeUnchanged: boolean;
  /** Whether the lists' selection-filter box is showing. */
  stagingFilterVisible: boolean;
  /** Run the commit hooks, or `--no-verify`. Off means the hooks run. */
  commitNoVerify: boolean;
  /** Close the commit screen once there is nothing left to commit. */
  commitCloseWhenDone: boolean;
}

export const IGNORE_WHITESPACE_NONE: Settings['diffIgnoreWhitespace'] = 'none';
export const DIFF_VIEW_SIDE_BY_SIDE: Settings['diffViewMode'] = 'sideBySide';
export const FILES_PANE_MODE_TREE: Settings['filesPaneMode'] = 'tree';
export const TOOLBAR_LABELS_NONE: Settings['toolbarLabels'] = 'none';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  dateFormat: 'relative',
  gitPath: null,
  terminalApp: null,
  commandLogDepth: 500,
  redactDiagnostics: false,
  recentRepos: [],
  // 50k is the stated scale target (`docs/ARCHITECTURE.md`), and 999999 was twenty times
  // it: on a large history that is a million rows held in the renderer plus a synchronous
  // `buildGraph` over all of them. The log streams, so this is a ceiling rather than a
  // wall, and it is raisable in Settings.
  commitLoadLimit: 50000,
  // All refs: walking HEAD alone hides unmerged branches and tags, leaving the grid with
  // no badges for them and the panel pointing at commits off screen.
  branchScope: 'all',
  branchFilter: '',
  logShowRemoteBranches: true,
  logShowTags: true,
  logShowStashes: true,
  logShowReflog: false,
  // Glyphs alone: the row is ten buttons and stays one row at any window width. Names are
  // a page away for anyone who wants them, and the `title` answers a single button.
  toolbarLabels: 'none',
  // The panel, the commit details and the file pane are what the window is for; the
  // command log is the one you open when you want to see what ran.
  showLeftPanel: true,
  showCommitDetails: true,
  showFilePane: true,
  showCommandLog: false,
  showArtificialCommits: true,
  graphDimNonRelatives: GRAPH_DIM_LANES,
  graphMergeCommonParentLanes: true,
  graphLineWidth: 'normal',
  quickSearchTimeout: 750,
  // Null rather than the default layout: nothing has been chosen yet, and
  // `normalizeColumns` produces the defaults from the column model itself.
  gridColumns: null,
  leftPanelWidth: 240,
  leftPanelSections: null,
  // Name, because a ref is looked up by the name you already know. Date sorting is
  // for the other question, "what have I been on lately?", and is one menu away.
  leftPanelSort: 'name',
  leftPanelSortAscending: true,
  // What changed, because that is what a commit is selected to find out. The tree is one
  // click away and remembered once chosen.
  filesPaneMode: 'changed',
  // The diff, because a commit is selected to find out what it did. Switching the list to
  // the tree does not switch this: a tree row's diff is a question worth asking too.
  filePaneView: 'diff',
  // Right: the left panel already owns the window's left edge, and reading the commit
  // left of the grid would squeeze history between two narrow columns.
  commitInfoPosition: 'right',
  // Tree: one directory reads the same either way, forty is unreadable flat. Dense: the
  // alternative here is a staircase of single-child folders.
  fileListView: 'tree',
  fileListDenseTree: true,
  fileListShowIgnored: false,
  authorInitials: true,
  showMessageBody: false,
  // Author date: when the work was written, the question history is read for. Committer
  // date is what rebase rewrites, dating a replayed branch all at one minute.
  showAuthorDate: true,
  diffViewMode: 'sideBySide',
  diffIgnoreWhitespace: 'none',
  diffContextLines: 3,
  diffWholeFile: false,
  // Null rather than `{}`: no dialog has been opened yet, and an empty object read back
  // is indistinguishable from one whose entries were all dropped as malformed.
  dialogBounds: null,
  // Every question is asked until it is answered with the box ticked.
  confirmSuppressions: null,
  repoFactsInDialogs: true,
  streamLiveOutput: false,
  commandOutputAutoClose: true,
  // Long enough to read "Done." and what git said last, short enough not to be in the way.
  // Five, not three: the window is showing you what git said, and three seconds is not
  // long enough to read a `push` summary before it goes. The Close button counts down, so
  // the number is visible and Keep Open is beside it.
  commandOutputAutoCloseSeconds: 5,
  // Don't change, don't always show, don't sweep untracked files into an automatic stash.
  checkoutLocalChanges: 'none',
  checkoutAlwaysShowDialog: false,
  checkoutUseDefaultLocalChanges: false,
  autoStashUntracked: false,
  normaliseBranchNames: true,
  normaliseBranchSymbol: '_',
  checkoutAfterResetOtherBranch: true,
  mergeNoFastForward: false,
  mergeNoCommit: false,
  mergeAddLogMessages: false,
  mergeLogMessageCount: 20,
  rebaseAutostash: false,
  stashIncludeUntracked: true,
  stashKeepIndex: false,
  cherryPickAutoCommit: true,
  cherryPickAddReference: false,
  pullAction: 'merge',
  pullAutostash: false,
  // Wide enough for a path with two directories above it, and a staged list deep enough
  // for the half-dozen files a commit usually has without crowding the unstaged one.
  commitListsWidth: 320,
  commitStagedHeight: 220,
  commitMessageHeight: 200,
  // Flat, unlike the file pane's default: read as a checklist of what you're about to
  // commit, shorter flat than folded into folders for a commit's handful of files.
  stagingListView: 'flat',
  stagingDenseTree: true,
  // Untracked files are the one thing here that is on by default: a new file missing
  // from the list before a commit is the worst thing this screen could get wrong.
  stagingShowUntracked: true,
  stagingShowIgnored: false,
  stagingShowSkipWorktree: false,
  stagingShowAssumeUnchanged: false,
  stagingFilterVisible: true,
  commitNoVerify: false,
  commitCloseWhenDone: false
};

/**
 * Read a stored `graphDimNonRelatives` back as one of the three current values: it was
 * two booleans before this ladder existed. Unrecognised falls to the default.
 */
export function toGraphDimming(dim: unknown, dimText: unknown): GraphDimming
{
  if (dim === GRAPH_DIM_NONE || dim === GRAPH_DIM_LANES || dim === GRAPH_DIM_ALL)
  {
    return dim;
  }
  if (dim === false)
  {
    return GRAPH_DIM_NONE;
  }
  if (dim === true)
  {
    if (dimText === true)
    {
      return GRAPH_DIM_ALL;
    }
    return GRAPH_DIM_LANES;
  }
  return DEFAULT_SETTINGS.graphDimNonRelatives;
}
