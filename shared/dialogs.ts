/**
 * Which dialogs exist, their titles, and their opening window sizes: the table both
 * main and `renderer/dialogs/routes.ts` read; a name with no route fails to typecheck.
 */

import type { LogOptions } from './types/commits.js';
import type { RepoTextFile } from './types/status.js';

export type DialogName =
  | 'settings'
  | 'about'
  | 'shortcuts'
  // Making a repository, rather than acting on one. The only two dialogs that open with
  // none of them open, so their `when` is not `hasRepo` and they run in a directory of
  // their own rather than in the window's repository.
  | 'repo.clone'
  | 'repo.init'
  // Branch
  | 'branch.checkout'
  | 'branch.create'
  | 'branch.rename'
  | 'branch.setUpstream'
  | 'branch.delete'
  | 'branch.deleteRemote'
  | 'branch.cleanup'
  | 'branch.merge'
  | 'branch.rebase'
  // Reset
  | 'reset.branch'
  | 'reset.changes'
  | 'reset.other'
  // Tags
  | 'tag.create'
  | 'tag.delete'
  // Two windows: one saves a stash, one manages the stashes there already. A single
  // window switching between them opens on the save form when nothing is stashed yet.
  | 'stash'
  | 'stash.manage'
  // Remotes
  | 'remote.pull'
  | 'remote.push'
  | 'remote.manage'
  // Commits
  // The commit screen: a real dialog window like every other, not the main window's own
  // overlay. See the `fullWindow` note below for what makes it different from the rest.
  | 'commit.open'
  | 'commit.cherry-pick'
  | 'commit.revert'
  | 'commit.checkout'
  | 'commit.archive'
  | 'commit.undo'
  | 'commit.reword'
  // The working directory
  | 'workdir.clean'
  // Repository maintenance. `repo.deleteIndexLock` is not here: nothing to ask means
  // it's a confirmation over a typed channel, not a dialog.
  | 'repo.gc'
  | 'repo.fsck'
  // Worktrees
  | 'worktree.create'
  | 'worktree.manage'
  // Comparing two revisions: a window, so the pane below the grid keeps its one job.
  | 'compare'
  // Submodules
  | 'submodule.manage'
  // Patches
  | 'patch.apply'
  | 'patch.format'
  | 'patch.view'
  // File operations
  | 'repo.editFile'
  | 'file.ignore'
  | 'file.move'
  // One window, two commands: `file.history` opens the Diff tab, `file.blame` the
  // Blame tab, a payload field deciding which facet is in front.
  | 'file.history'
  // Conflict resolution
  | 'conflicts.resolve'
  // One conflicted file, base/ours/theirs plus the editable result: opened from a row
  // in `conflicts.resolve` alongside the external-mergetool action, not instead of it.
  | 'conflicts.editFile'
  // Navigation: not an operation dialog. It resolves a revision and moves the
  // repository window's selection, a read and a message rather than a command.
  | 'navigate.goToCommit'
  // Search: not an operation dialog either. `git grep` reads, so there is nothing to
  // invalidate and nothing to close the window over.
  | 'search.grep'
  // View: not an operation dialog. It sets what the grid's query looks like rather
  // than running a git command, with no argv of its own to preview.
  | 'view.advancedFilter'
  // The command a dialog is running, and its output, in a window of its own. Not
  // modal and not opened from a menu: `main/dialogs.ts`'s `openOutputWindow` raises it
  // beside whatever asked, so the dialog that started the run keeps awaiting it.
  | 'commandOutput';

/**
 * Who asked for the window, not what it's about. A menu row's dialog replaces
 * whatever else is open; one the app raises itself must not, so the two are told apart here.
 */
export interface DialogOpenOptions {
  /**
   * Nobody asked: the app raised this itself (the resolver, for conflicts that appear
   * mid-run). Dropped when another dialog is already open, rather than closing it.
   */
  automatic?: boolean;
}

/**
 * What a dialog is opened *about*, plain JSON across IPC and the query string. A
 * dialog reads its operand from here, never the main window's selection, which may have moved on.
 */
export interface DialogPayload {
  /** The repository the dialog acts on. Filled in by `ui.openDialog`, not call sites. */
  repoPath?: string;
  /** Ref name or SHA the dialog operates on. */
  ref?: string;
  /**
   * A ref to open on without being fixed to it: the picker still offers every ref.
   * Unlike `ref`, shown read-only as an operand: this is a guess, so it must be as easy to overrule as to make.
   */
  suggestedRef?: string;
  /** Branch name for rename, delete, and setting what a branch tracks. */
  branchName?: string;
  /** Tag name, for the push dialog's tags tab. */
  tagName?: string;
  /**
   * git's stderr from a push that already failed elsewhere (Commit and Push); shown
   * on the push dialog's remedy screen for a "the remote has moved" rejection.
   */
  pushRejection?: string;
  /** Stash ref (e.g. `stash@{0}`). */
  stashRef?: string;
  /** Stash index. */
  stashIndex?: number;
  /** Remote name. */
  remoteName?: string;
  /** Commit SHA. */
  sha?: string;
  /**
   * The compare dialog's two ends, as typed revisions (SHA, branch, tag, `HEAD`),
   * resolved by the dialog itself: not `DiffEndpoint`s, since the payload crosses as JSON first.
   */
  compareBase?: string;
  compareTo?: string;
  /**
   * A filesystem path the dialog is about: a file for the ignore and rename dialogs,
   * a directory for the worktree list.
   */
  filePath?: string;
  /**
   * The paths a file menu was opened over: ignoring four files is one rule per file,
   * not four dialogs.
   */
  filePaths?: readonly string[];
  /**
   * Which ignore file: `file.ignore` and `file.exclude` are two menu rows onto one
   * window, a radio in it rather than a second dialog.
   */
  ignoreTarget?: 'gitignore' | 'exclude';
  /**
   * Which file `repo.editFile` opens: three menu rows onto one identical editor, same
   * shape as `ignoreTarget` above.
   */
  repoTextFile?: RepoTextFile;
  /** Open the stash dialog with only what is staged selected for stashing. */
  stagedOnly?: boolean;
  /**
   * What the pull dialog opens set to: the surface decides. Fetch rows open `fetch`,
   * "Fetch and Rebase" opens `rebase`, a bare Pull keeps whatever ran last.
   */
  pullAction?: 'merge' | 'rebase' | 'fetch';
  /** Open the pull dialog with pruning ticked: the left panel's "Fetch and Prune" row. */
  prune?: boolean;
  /**
   * Which uncommitted changes `reset.changes` is about: everything, or only unstaged.
   * The opening surface decides.
   */
  discardScope?: 'all' | 'unstaged';
  /**
   * How the rebase dialog opens: one window, three states. `rebaseInteractive` ticks
   * `-i`, `rebaseAdvanced` expands the options panel: both the surface's decision, not a setting.
   */
  rebaseInteractive?: boolean;
  rebaseAdvanced?: boolean;
  /**
   * The session filter fields the Advanced Filter dialog opens on, filled from
   * `revisions.options` at open time: what was true then, never a store it doesn't have.
   */
  logFilter?: LogOptions;
  /**
   * Which facet of `file.history` to open on: `'diff'` or `'blame'`, the surface's
   * decision, same reasoning as `rebaseInteractive` above.
   */
  fileHistoryTab?: 'diff' | 'blame' | 'view';
  /**
   * What the `commandOutput` window is watching, in the order it runs. The ids are
   * minted by whoever starts the runs, before the first one starts, so the window can
   * follow a multi-command operation from one end to the other.
   */
  outputSteps?: readonly OutputStep[];
  /**
   * Keep this console up when the run succeeds, whatever the auto-close setting says.
   *
   * For a command whose output *is* the answer rather than progress about work being
   * done: a `--dry-run` listing what would be deleted, an `fsck --lost-found` naming
   * every object it wrote. Closing those after a few seconds throws away the thing the
   * button was pressed to read.
   */
  outputKeepOpen?: boolean;
}

/** One command the `commandOutput` window follows: see `outputSteps`. */
export interface OutputStep {
  /** What this command is for, shown above its output: "Stashing your changes". */
  label: string;
  argv: string[];
  /** The `stream:start` request id whose `event:streamLine` batches are this command's. */
  requestId: number;
  /**
   * A run that is over before the window exists: what it said, and how it ended.
   *
   * A command nobody was watching still has output worth reading the moment it fails,
   * and that output is a rejected promise rather than a stream. Set only for a run
   * there is nothing left to follow; a live one leaves this out and is watched by id.
   */
  finished?: {
    lines: string[];
    exitCode: number | null;
  };
}

export interface DialogWindowSpec {
  /** The window title. A dialog whose title varies also draws its own heading. */
  title: string;
  /** The size the window opens at the first time. Overridden once it is resized. */
  width: number;
  height: number;
  /**
   * Where this dialog's bounds are stored, when that is not its name. Bump this, not
   * the numbers, when a rebuilt dialog is a different shape: reusing the name reopens
   * the new form at the old one's size, cropped.
   */
  boundsKey?: string;
  /**
   * Open at the size of the window this dialog was opened from, every time: a
   * workspace has no size worth guessing. Non-minimizable, since macOS disables the zoom
   * button on a modal window anyway. `width`/`height` are required by the type but unused.
   */
  fullWindow?: boolean;
}

/** The key a dialog's window bounds are stored under. Its name unless it says otherwise. */
export function boundsKeyFor(name: DialogName): string
{
  return DIALOG_WINDOWS[name].boundsKey ?? name;
}

/**
 * The window each dialog opens. Sizes are starting points; every window remembers its
 * own resize. See `docs/DIALOGS.md` for the `fixedHeight`/`fullWindow` sizing exceptions below.
 */
export const DIALOG_WINDOWS: Record<DialogName, DialogWindowSpec> = {
  // `fixedHeight`: wide enough for the list plus a form beside it, tall enough for most pages.
  settings: { title: 'Settings', width: 780, height: 640, boundsKey: 'settings.v2' },
  about: { title: 'About gitext', width: 460, height: 380 },
  // Wide rather than tall: a URL and two paths are long strings, and everything past the
  // two fields you always fill in is behind a disclosure.
  'repo.clone': { title: 'Clone Repository', width: 640, height: 460 },
  'repo.init': { title: 'New Repository', width: 620, height: 380 },
  // `fixedHeight`: two columns of a reference document.
  shortcuts: {
    title: 'Keyboard Shortcuts',
    width: 900,
    height: 620,
    boundsKey: 'shortcuts.v2'
  },

  // Tall enough that either conditional panel (remote-branch, Local Changes) fits
  // without opening already scrolled.
  'branch.checkout': {
    title: 'Checkout Branch',
    width: 560,
    height: 720,
    boundsKey: 'branch.checkout.v2'
  },
  'branch.create': {
    title: 'Create Branch',
    width: 540,
    height: 620,
    boundsKey: 'branch.create.v2'
  },
  'branch.rename': { title: 'Rename Branch', width: 480, height: 300 },
  'branch.setUpstream': { title: 'Set Upstream', width: 540, height: 340 },
  'branch.delete': {
    title: 'Delete Branches',
    width: 520,
    height: 560,
    boundsKey: 'branch.delete.v2'
  },
  // Plural: it is a list, whether one surface ticked a branch in it or not. The
  // frame's own title says which remote once the window knows.
  'branch.deleteRemote': { title: 'Delete Remote Branches', width: 540, height: 420 },
  // Taller than the other branch dialogs: a list read before acting on it, so it
  // shouldn't open already scrolled.
  'branch.cleanup': { title: 'Clean Up Branches', width: 640, height: 620 },
  // The advanced panel is folded by default but has to fit when it opens.
  'branch.merge': {
    title: 'Merge Branch',
    width: 580,
    height: 620,
    boundsKey: 'branch.merge.v2'
  },
  // The options panel is long, and the window doubles as the mid-rebase control panel.
  'branch.rebase': {
    title: 'Rebase',
    width: 860,
    height: 700,
    boundsKey: 'branch.rebase.v3'
  },

  // Five modes with a line of explanation each, plus the summary.
  'reset.branch': {
    title: 'Reset Current Branch',
    width: 800,
    height: 640,
    boundsKey: 'reset.branch.v3'
  },
  // A confirmation, not a form: the two checkboxes and the plan, and nothing else.
  'reset.other': { title: 'Reset Another Branch', width: 560, height: 560 },
  'reset.changes': {
    title: 'Reset Changes',
    width: 540,
    height: 460,
    boundsKey: 'reset.changes.v2'
  },

  'tag.create': {
    title: 'Create Tag',
    width: 560,
    height: 700,
    boundsKey: 'tag.create.v2'
  },
  'tag.delete': {
    title: 'Delete Tag',
    width: 520,
    height: 400,
    boundsKey: 'tag.delete.v2'
  },

  // `fullWindow`, both: each is a file list beside a diff, which is a workspace rather
  // than a form. `width`/`height` are unused placeholders.
  'stash': { title: 'Stash Changes', width: 760, height: 800, fullWindow: true },
  'stash.manage': { title: 'Manage Stashes', width: 900, height: 800, fullWindow: true },

  'remote.pull': {
    title: 'Pull / Fetch',
    width: 600,
    height: 720,
    boundsKey: 'remote.pull.v2'
  },
  'remote.push': {
    title: 'Push',
    width: 600,
    height: 720,
    boundsKey: 'remote.push.v2'
  },
  // A list beside an editor: wide, and tall enough for three URL fields plus the plan
  // beneath them.
  'remote.manage': {
    title: 'Manage Remotes',
    width: 760,
    height: 560,
    boundsKey: 'remote.manage.v2'
  },

  // `fullWindow`, like `stash`: a workspace, not a form, sized to match the repository window.
  'commit.open': { title: 'Commit', width: 1200, height: 800, fullWindow: true },

  'commit.cherry-pick': {
    title: 'Cherry-pick Commit',
    width: 560,
    height: 620,
    boundsKey: 'commit.cherry-pick.v2'
  },
  'commit.revert': {
    title: 'Revert Commit',
    width: 560,
    height: 580,
    boundsKey: 'commit.revert.v2'
  },
  'commit.checkout': {
    title: 'Checkout Revision',
    width: 520,
    height: 640,
    boundsKey: 'commit.checkout.v2'
  },
  'commit.archive': {
    title: 'Archive Revision',
    width: 760,
    height: 660,
    boundsKey: 'commit.archive.v3'
  },
  'commit.undo': { title: 'Undo Last Commit', width: 520, height: 420 },
  // An eight-row message box plus the summary above and the rebuilt-SHA note below
  // HEAD; `fit.ts` sizes it from there.
  'commit.reword': { title: 'Reword Commit', width: 580, height: 560 },

  // Two path boxes and a preview pane: tall enough to read the dry run's output
  // without dragging.
  'workdir.clean': {
    title: 'Clean Working Directory',
    width: 800,
    height: 700,
    boundsKey: 'workdir.clean.v2'
  },

  // Short on open; grows for the output pane, which `fit.ts` handles, rather than
  // guessing tall and leaving empty space under the command.
  'repo.gc': { title: 'Compress Git Database', width: 600, height: 340 },
  // `fixedHeight` + `fullWindow`: the pane varies from a paragraph to a full Monaco
  // patch and the list rebuilds on every filter, so nothing here has a size worth
  // guessing; a fixed 900×600 left the patch pane at its 120px floor.
  'repo.fsck': { title: 'Recover Lost Objects', width: 900, height: 600, fullWindow: true },

  // A path field with a folder picker, the three checkout choices and a commit picker.
  'worktree.create': {
    title: 'Create Worktree',
    width: 780,
    height: 640,
    boundsKey: 'worktree.create.v2'
  },
  // A list beside a pane, like the remotes dialog: paths are long, so it is wide.
  'worktree.manage': { title: 'Manage Worktrees', width: 800, height: 520 },

  // `fullWindow` + `fixedHeight`: three panes of side-by-side diff have no size worth
  // guessing, and nothing here to measure as a form.
  compare: { title: 'Compare', width: 1040, height: 680, fullWindow: true },

  // The list, the add form and the per-submodule pane in one window.
  'submodule.manage': { title: 'Submodules', width: 780, height: 560 },

  // Both a form and a preview; apply doubles as the mid-`am` control panel.
  'patch.apply': { title: 'Apply Patch', width: 580, height: 520 },
  'patch.format': { title: 'Format Patch', width: 580, height: 560 },
  // `fixedHeight`: a file list beside the selected file's hunks, a browse shape, not
  // a form. Wide, so a side-by-side diff has room.
  'patch.view': { title: 'View Patch File', width: 940, height: 620 },

  // One window for `.gitignore`, `.gitattributes`, `.git/info/exclude` and
  // `.git/config`: the payload says which. `fixedHeight`, since the text box fills whatever height is given.
  'repo.editFile': { title: 'Edit File', width: 720, height: 620 },

  'file.ignore': {
    title: 'Ignore Files',
    width: 580,
    height: 640,
    boundsKey: 'file.ignore.v2'
  },
  'file.move': { title: 'Rename / Move', width: 560, height: 320 },
  // Browse shape like `remote.manage`, but `fullWindow` like `stash`: three Monaco
  // panes (diff/blame/view) want the repository window's room, not a guessed size.
  'file.history': { title: 'File History', width: 960, height: 640, fullWindow: true },

  'conflicts.resolve': { title: 'Solve Merge Conflicts', width: 720, height: 560 },

  // `fullWindow` + `fixedHeight`, like `compare`: three read-only panes plus the one
  // you edit, no size worth guessing.
  'conflicts.editFile': { title: 'Resolve Conflict', width: 1040, height: 720, fullWindow: true },

  // Tall: several rows are conditional (Ignore case, Branches), so a window sized for
  // none of them opens scrolled. `fixedHeight`: the list rebuilds every keystroke, so
  // nothing here should resize under typing.
  'navigate.goToCommit': { title: 'Go to Commit', width: 480, height: 460 },

  // `fixedHeight`: the results list is however long the repository's matches are, no
  // size to converge on. Wide, so a matched line of code doesn't wrap; tall enough to
  // read more than six rows at once.
  'search.grep': { title: 'Find in Files', width: 860, height: 620 },

  'view.advancedFilter': {
    title: 'Advanced Filter',
    width: 780,
    height: 640,
    boundsKey: 'view.advancedFilter.v2'
  },

  // A console: wide enough for git's progress lines, tall enough to read a few at once.
  // The output pane scrolls inside it, so the window keeps whatever size it is given.
  commandOutput: { title: 'Git Output', width: 720, height: 420 }
};

/** Runtime membership test: the query string a dialog window is loaded with is text. */
export function isDialogName(value: string): value is DialogName
{
  return Object.hasOwn(DIALOG_WINDOWS, value);
}
