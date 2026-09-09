/**
 * The IPC contract: the single source of truth for everything crossing the process
 * boundary. Add a channel here and implement its handler; nothing else to sync.
 */

import type { DiagnosticKind } from './types/diagnostics.js';
import type { DialogName, DialogOpenOptions, DialogPayload } from './dialogs.js';
import type { DiffEndpoint, DiffFileEntry, DiffOptions, DiffPatch, DiffRange } from './diff.js';
import type { FsckOptions } from './fsck.js';
import type { GrepOptions, GrepResult } from './grep.js';
import type { RepoFacet } from './invalidation.js';
import type { BlobContents, TreeEntry } from './tree.js';
import type {
  BlameFile,
  CommitDetails,
  CommitRow,
  CommitSummary,
  ConfigScope,
  ConfigWriteScope,
  ConflictBlobs,
  ConflictSides,
  GitCommandRecord,
  GitEnvironment,
  GitStreamBatch,
  StreamState,
  HealthCheckItem,
  IgnoreTarget,
  LogBatch,
  LostObject,
  LogOptions,
  MessageFileName,
  BranchCleanupReport,
  RefEntry,
  RemoteEntry,
  RepoInfo,
  RepoState,
  RepoTextFile,
  RevisionSummary,
  Settings,
  StashEntry,
  SubmoduleEntry,
  SubmoduleStatusEntry,
  WorkingTreeStatus,
  WorktreeEntry
} from './types.js';

/**
 * Request/response channels: `(...args) => Promise<Result>`. Handlers reject with a
 * `GitErrorPayload`; the renderer rethrows it (see `renderer/api.ts`).
 */
export interface Invocations {
  // ── Settings ──────────────────────────────────────────────────────────────
  'settings:get': () => Settings;
  'settings:patch': (patch: Partial<Settings>) => Settings;

  // ── Environment & health ──────────────────────────────────────────────────
  /** The app's own name and version, for About and for a bug report. */
  'env:app': () => { name: string; version: string; electron: string };
  'env:git': () => GitEnvironment;
  'env:health': (repoPath: string | null) => HealthCheckItem[];
  /**
   * BCP-47 locale tag, or `''` for `Intl`'s default. Only main can see the OS region;
   * Chromium hands the renderer just the app's language.
   */
  'env:locale': () => string;

  // ── Repository ────────────────────────────────────────────────────────────
  /** Returns null when the path is not inside a git working tree. */
  'repo:open': (path: string) => RepoInfo | null;
  /** Native folder picker; returns null if the dialog was cancelled. */
  'repo:pick': () => RepoInfo | null;
  'repo:info': (repoPath: string) => RepoInfo | null;
  'repo:state': (repoPath: string) => RepoState;
  'repo:status': (repoPath: string) => WorkingTreeStatus;
  /** Begin watching `.git` for this repo; idempotent per repo. */
  'repo:watch': (repoPath: string) => void;
  'repo:unwatch': (repoPath: string) => void;
  /**
   * Hand a path to the OS's default handler: what double-clicking it does. A directory
   * opens in Finder, a file opens in whatever owns its type. Not a reveal: selecting a
   * path *inside* its enclosing folder is `repo:showItemInFolder`.
   */
  'repo:openPath': (path: string) => void;
  /**
   * Open a repository in the window this message came from (or, from a dialog, the
   * window that owns it): relayed as `event:openRepo` since a dialog has no repo store.
   */
  'repo:openHere': (path: string) => void;
  /** Drop one path from the recent list. Returns the list that remains. */
  'repo:forgetRecent': (path: string) => string[];
  /**
   * Open a repository in a *new* window, leaving this one where it is: distinct from
   * `repo:openHere` since a submodule to work in differs from one to read beside it.
   */
  'repo:openWindow': (path: string) => void;
  /** Reveal this path in Finder with it selected, rather than opening it. */
  'repo:showItemInFolder': (path: string) => void;
  /**
   * Open a terminal at this directory. Which terminal is main's choice; rejects when
   * none could be opened, so the failure is a toast rather than a dead menu row.
   */
  'repo:openTerminal': (path: string) => void;

  // ── Dialog windows ────────────────────────────────────────────────────────
  /**
   * Open a dialog as its own modal window; opening one already open focuses it. No
   * result channel: the dialog runs its own git through `git:run` and broadcasts it.
   */
  'dialog:open': (
    name: DialogName,
    payload: DialogPayload,
    options?: DialogOpenOptions
  ) => void;
  /** Close the calling dialog window. A no-op from the repository window. */
  'dialog:close': () => void;
  /**
   * Raise the command-output console beside the caller, following the runs named in
   * `outputSteps`. Not `dialog:open`: that opens a *modal* window, which the caller
   * would then be blocked behind and which would die with the caller when it closes on
   * success. This one is neither modal nor a child of the dialog that asked, so a
   * console the user chose to keep open outlives the operation that filled it.
   */
  'dialog:openOutput': (payload: DialogPayload) => void;
  /**
   * The calling dialog's content height in pixels; also the signal it has drawn, which
   * `main/dialogs/fit.ts` waits on before showing (it won't touch a window the user resized).
   */
  'dialog:fit': (contentHeight: number) => void;
  /**
   * "Show in File Tree" from the commit dialog: relayed to the owner as
   * `event:showInFileTree`, then this window closes.
   */
  'dialog:showInFileTree': (path: string) => void;
  /**
   * Apply the Advanced Filter dialog's session fields (author, message, date range, etc.)
   * as `event:applyLogFilter`; everything else it sets is a persisted setting instead.
   */
  'dialog:applyLogFilter': (filter: LogOptions) => void;
  /**
   * Move the repository window's selection to this commit, as `event:goToRevision`.
   * A full SHA, already resolved by the dialog.
   */
  'dialog:goToRevision': (sha: string) => void;
  /**
   * The system clipboard as text, readable only from main. Asked only on an explicit
   * user action, to check whether it names a revision.
   */
  'clipboard:read': () => string;

  // ── Revision log ──────────────────────────────────────────────────────────
  /**
   * Begin streaming commits; batches arrive on `event:logBatch` tagged with `requestId`.
   * Starting a read supersedes the previous one for this repo.
   */
  'revisions:start': (requestId: number, repoPath: string, options: LogOptions) => void;
  'revisions:cancel': (requestId: number) => void;
  /** Count what a query would return, for the "showing N of M" affordance. */
  'revisions:count': (repoPath: string, options: LogOptions) => number;
  /**
   * Signature verification and git notes for one commit: too costly to carry in the
   * grid query, so fetched only for the selected row.
   */
  'revisions:details': (repoPath: string, sha: string) => CommitDetails;
  /**
   * Resolve a revision expression (SHA prefix, branch, tag, `HEAD~2`) to a commit.
   * Null rather than a rejection: the compare dialog asks on every keystroke.
   */
  'revisions:describe': (repoPath: string, rev: string) => CommitSummary | null;

  // ── File history & blame ─────────────────────────────────────────────────
  /** The commits that touched one file, `--follow`ed across renames, over HEAD's history. */
  'file:history': (repoPath: string, path: string) => CommitRow[];
  /**
   * Blame `path` as of `revision`, or the working tree when null: see
   * `main/git/blame.ts` for why that distinction matters.
   */
  'file:blame': (repoPath: string, revision: DiffEndpoint | null, path: string) => BlameFile;

  // ── Searching file contents ──────────────────────────────────────────────
  /**
   * `git grep` over the working tree, index, or a commit. Typed rather than `git:run`
   * because the result is a hit list, not text; no matches is an empty list, not a failure.
   */
  'search:grep': (repoPath: string, options: GrepOptions) => GrepResult;

  // ── Diffs ─────────────────────────────────────────────────────────────────
  /**
   * The paths that differ between the range's two endpoints, untracked files
   * included when one of them is the working tree.
   */
  'diff:files': (repoPath: string, range: DiffRange, options: DiffOptions) => DiffFileEntry[];
  /**
   * One file's patch; takes the entry rather than a path since a rename needs both
   * names and an untracked file needs a different command.
   */
  'diff:patch': (
    repoPath: string,
    range: DiffRange,
    file: DiffFileEntry,
    options: DiffOptions
  ) => DiffPatch;
  /**
   * Write one file's contents, as of the range's newer end, wherever a save dialog says.
   * Returns the path written, or null if the dialog was cancelled.
   */
  'diff:saveFileAs': (repoPath: string, range: DiffRange, file: DiffFileEntry) => string | null;

  // ── Partial staging ───────────────────────────────────────────────────────
  /**
   * Put a patch into the index, or take it back out (`git apply --cached`, reversed to
   * unstage): the only way to stage part of a file, since there is no porcelain for it.
   */
  'stage:applyPatch': (
    repoPath: string,
    patch: string,
    direction: 'stage' | 'unstage'
  ) => void;
  /**
   * Apply a patch to the working tree rather than the index: "reset chunk of file"
   * when reversed, "cherry-pick these changes in" when not.
   */
  'stage:applyToWorkingTree': (repoPath: string, patch: string, reverse: boolean) => void;
  /** Set or clear `--skip-worktree` / `--assume-unchanged` on paths. */
  'stage:setIndexFlag': (
    repoPath: string,
    paths: string[],
    flag: 'skip-worktree' | 'assume-unchanged',
    on: boolean
  ) => void;
  /** Which paths currently carry either flag, so the menu can draw its ticks. */
  'stage:indexFlags': (
    repoPath: string
  ) => { skipWorktree: string[]; assumeUnchanged: string[] };
  /** `git rm --cached`: out of the index, still on disk. */
  'stage:stopTracking': (repoPath: string, paths: string[]) => void;

  // ── Working-tree file operations ──────────────────────────────────────────
  /**
   * Delete files. Tracked ones go through `git rm -f`, untracked ones are unlinked:
   * `git rm` fails on a path that is not in the index.
   */
  'file:delete': (repoPath: string, tracked: string[], untracked: string[]) => void;
  /**
   * Current contents of an ignore file, `''` if absent. Read so the dialog can preview
   * an append before writing it.
   */
  'file:ignoreRules': (repoPath: string, target: IgnoreTarget) => string;
  /**
   * One of the four repo text files, whole, `''` if absent. Named by target rather
   * than path: this one writes too, and a path arg would open writes anywhere on disk.
   */
  'file:readRepoText': (repoPath: string, target: RepoTextFile) => string;
  /**
   * Whether git can parse `text` as this target; only `config` ever answers, since git
   * refuses to run at all against a config it cannot parse.
   */
  'file:checkRepoText': (repoPath: string, target: RepoTextFile, text: string) => string | null;
  /** Replace the file's contents, creating it and its directory if needed. */
  'file:writeRepoText': (repoPath: string, target: RepoTextFile, text: string) => void;
  /**
   * A working-tree file's text, read and written. Repo-relative path, resolved and
   * confined inside the working tree (`resolveInRepo`), unlike the targets above.
   */
  'file:readWorkingText': (repoPath: string, path: string) => string;
  'file:writeWorkingText': (repoPath: string, path: string, text: string) => void;
  /** Append rules to one of them. Existing lines are the caller's to filter out. */
  'file:addIgnoreRules': (
    repoPath: string,
    target: IgnoreTarget,
    patterns: string[]
  ) => void;
  /** Hand a file at some revision to the OS as a temp file, and return where it went. */
  'file:openRevision': (repoPath: string, endpoint: DiffEndpoint, path: string) => string;
  /** `git difftool` on one path, detached: it opens a window of its own. */
  'file:difftool': (repoPath: string, range: DiffRange, path: string) => void;
  /**
   * Two different files at one revision, compared against each other, via
   * `difftool --no-index` on two written-out temp files: the axis git has no verb for.
   */
  'file:compareTwo': (
    repoPath: string,
    endpoint: DiffEndpoint,
    first: string,
    second: string
  ) => void;
  /** Hand a file at some revision to whichever application the user picks. */
  'file:openRevisionWith': (repoPath: string, endpoint: DiffEndpoint, path: string) => void;
  /** Hand a working-tree file to whichever application the user picks. */
  'file:openWith': (nativePath: string) => void;
  /**
   * Where to write a file, or null if cancelled; writes nothing itself. Lets the
   * archive dialog pick the destination first, so `--output <path>` shows in its preview.
   */
  'file:chooseSavePath': (
    defaultName: string,
    extensions: string[]
  ) => string | null;
  /**
   * A directory, or null if cancelled. Distinct from `repo:pick`, which also opens the
   * pick as a repository.
   */
  'file:chooseDirectory': (defaultPath: string) => string | null;
  /**
   * A patch file or a directory of them (`git am` takes either); `mode: 'file'` narrows
   * it for the viewer, which has nothing to show for a directory.
   */
  'file:choosePatch': (defaultPath: string, mode?: 'file' | 'fileOrDirectory') => string | null;

  // ── The tree at a revision ────────────────────────────────────────────────
  /**
   * Every file the repository contains at `endpoint`: what was *there*, not what
   * changed. The working tree adds untracked files and drops ones deleted on disk.
   */
  'tree:list': (repoPath: string, endpoint: DiffEndpoint) => TreeEntry[];
  /**
   * One file's contents at `endpoint`; takes the entry, not a path, since a submodule
   * has no blob to read and must say so rather than fail at `git show`.
   */
  'tree:blob': (repoPath: string, endpoint: DiffEndpoint, entry: TreeEntry) => BlobContents;

  // ── Conflict resolution ────────────────────────────────────────────────────
  /**
   * The three sides of one conflicted file plus git's own merge attempt on disk: what
   * the in-app conflict editor needs to draw base/ours/theirs. A read; nothing changes.
   */
  'conflicts:readBlobs': (repoPath: string, path: string) => ConflictBlobs;
  /**
   * Replace a conflicted file's working-tree contents with the editor's text. Marking
   * it resolved is a separate `git add` through `git:run`, so the log shows both steps.
   */
  'conflicts:writeResolved': (repoPath: string, path: string, text: string) => void;
  /**
   * Which real commit "ours" and "theirs" are for the operation in progress, with
   * history behind each, rather than just git's stage numbers.
   */
  'conflicts:readSides': (repoPath: string) => ConflictSides;

  // ── Repository objects (the left panel) ───────────────────────────────────
  /** Local branches, remote branches and tags, in one `for-each-ref`. */
  'refs:list': (repoPath: string) => RefEntry[];
  /**
   * Full names of refs already containing `commit`, so the panel can mark branches
   * with nothing new. Separate from `refs:list`: it changes with the grid selection.
   */
  'refs:merged': (repoPath: string, commit: string) => string[];
  /**
   * Local branches whose work already landed on `comparison`. Its own channel: proving
   * a squash-merge landed costs subprocesses per branch, unlike `refs:list`'s watcher tick.
   */
  'branch:stale': (repoPath: string, comparison: string) => BranchCleanupReport;
  'remote:list': (repoPath: string) => RemoteEntry[];
  'stash:list': (repoPath: string) => StashEntry[];
  /** Always at least one entry: the repository's own working tree is a worktree. */
  'worktree:list': (repoPath: string) => WorktreeEntry[];
  /** What `.gitmodules` declares, plus whether each is checked out. */
  'submodule:list': (repoPath: string) => SubmoduleEntry[];
  /**
   * `git submodule status`: each one's commit and whether it matches what the
   * superproject records. Separate from `submodule:list`: it walks into every submodule.
   */
  'submodule:status': (repoPath: string) => SubmoduleStatusEntry[];

  // ── Facts a dialog needs before it can be filled in ───────────────────────
  /**
   * How far `ref` is from `base` (HEAD by default) each way; null for an unborn HEAD,
   * a missing ref, or no merge base. Expensive, so asked per selected ref, not per row.
   */
  'repo:aheadBehind': (
    repoPath: string,
    ref: string,
    base?: string
  ) => { ahead: number; behind: number } | null;
  /**
   * Whether `ancestor` is contained in `descendant`. False also when either ref is
   * missing, which means "not a fast-forward" either way.
   */
  'repo:isAncestor': (repoPath: string, ancestor: string, descendant: string) => boolean;
  /** The branches a remote has right now, short names, without fetching. */
  'remote:heads': (repoPath: string, remote: string) => string[];
  /**
   * What a revision is in one line (SHA, subject, author, date), for a dialog window
   * with no grid to look it up in. Null if unresolved; annotated tags peeled.
   */
  'repo:revision': (repoPath: string, rev: string) => RevisionSummary | null;
  /**
   * A commit's full message. `repo:revision` carries only the subject; the reword
   * dialog's operand is the message itself.
   */
  'repo:commitMessage': (repoPath: string, rev: string) => string;
  /**
   * A revision's parents in git's own order, the numbering `-m <n>` uses: drawn when
   * the commit is a merge, since "parent 1 or 2" is unanswerable from two SHAs.
   */
  'repo:parents': (repoPath: string, sha: string) => RevisionSummary[];
  /**
   * Whether git would accept this as a branch name (`check-ref-format --branch`),
   * asked of git rather than reimplemented as a regex here.
   */
  'repo:validBranchName': (repoPath: string, name: string) => boolean;
  /**
   * Effective config values for these keys; unset keys are absent, not empty, since
   * unset and false are different answers.
   */
  'repo:config': (repoPath: string, keys: string[]) => Record<string, string>;
  /**
   * The same read, but of one named config file rather than what git resolves: a form
   * writing `--global` needs to show what `--global` holds. `repoPath` is nullable
   * since `--global` is answerable with nothing open.
   */
  'config:read': (
    repoPath: string | null,
    scope: ConfigScope,
    keys: string[]
  ) => Record<string, string>;
  /**
   * Set a config key, or unset it with `null`. Not `git:run`: the value is typed into
   * settings rather than built by a dialog, and there is no repository to invalidate.
   */
  'config:write': (
    repoPath: string | null,
    scope: ConfigWriteScope,
    key: string,
    value: string | null
  ) => void;
  /**
   * Delete `.git/index.lock`, answering whether one was there. Its own channel: the
   * lock's path (`rev-parse --absolute-git-dir`) is filesystem, not a git verb.
   */
  'repo:deleteIndexLock': (repoPath: string) => boolean;
  /**
   * Objects nothing points at, described: `fsck` names them, `log` describes them.
   * Forty rows of bare hex would not be a recovery tool.
   */
  'repo:fsck': (repoPath: string, options: FsckOptions) => LostObject[];
  /**
   * Read a `.patch` file off disk for the viewer, no repository involved: a patch
   * someone sent you is wherever they sent it.
   */
  'file:readPatch': (path: string) => BlobContents;

  // ── Command log (§8) ──────────────────────────────────────────────────────
  'log:list': () => GitCommandRecord[];
  'log:clear': () => void;

  // ── Diagnostics ───────────────────────────────────────────────────────────
  /**
   * Add to the session timeline from the renderer: a command the user ran, or an error
   * this window threw. Main records git and its own errors directly.
   */
  'diagnostics:record': (
    kind: DiagnosticKind,
    text: string,
    detail?: string[],
    durationMs?: number
  ) => void;
  /**
   * Write the timeline where the user chooses. Returns the path written, or null when
   * the save dialog was cancelled.
   */
  'diagnostics:save': () => string | null;

  // ── Write operations ─────────────────────────────────────────────────────
  /**
   * Run git argv, returning stdout only (`stream:start` carries both streams live).
   * `facets` is required: every dialog's argv passes through this one channel, so it's
   * the only place that can be made to declare what it invalidates.
   */
  'git:run': (repoPath: string, argv: string[], facets: readonly RepoFacet[]) => string;

  /**
   * Run git argv, streaming both output streams as they arrive: for a run worth
   * watching (`gc` repacking, `fsck --lost-found`) rather than one whose result matters.
   * Batches on `event:streamLine`; a run with an id already in flight is replaced.
   */
  'stream:start': (
    requestId: number,
    repoPath: string,
    argv: string[],
    facets: readonly RepoFacet[]
  ) => void;
  /** Kill the run with this id. Its final batch still arrives, with `exitCode: null`. */
  'stream:cancel': (requestId: number) => void;
  /**
   * What a run has said so far, for a window that arrived after it started. The console
   * window is opened by the window that starts the run, so a quick command can be over
   * before the console has mounted and subscribed; this is how it catches up. Null once
   * the run has aged out of what main keeps.
   */
  'stream:state': (requestId: number) => StreamState | null;

  /**
   * Write one of git's message files (`MERGE_MSG`, `TAG_EDITMSG`) and return its path;
   * unlike `-m`, this survives an operation that stops before committing.
   */
  'git:writeMessageFile': (
    repoPath: string,
    name: MessageFileName,
    message: string
  ) => string;

  /**
   * Read one of git's message files, `''` if absent: git overwrites `MERGE_MSG` when
   * an operation stops, so a revert must read a message back before running.
   */
  'git:readMessageFile': (repoPath: string, name: MessageFileName) => string;
  /**
   * Activate or deactivate a remote by renaming its config section to/from
   * `-remote.<name>`. Its own channel: how many `git config` calls it takes varies.
   */
  'remote:setEnabled': (repoPath: string, name: string, enabled: boolean) => void;

  // ── The native menu ───────────────────────────────────────────────────────

  /**
   * What the menu bar draws beside each row. The registry and its predicates live in
   * the renderer; main applies whichever rows it carries, sent as one map since a
   * delta would need main to hold a copy to diff against.
   */
  'menu:state': (states: MenuItemStates) => void;
}

/**
 * One menu row's state. `checked` is absent for a row that isn't a toggle, and that
 * absence is the whole signal for whether main draws a checkbox.
 */
export interface MenuItemState {
  enabled: boolean;
  checked?: boolean;
  /** Set when the row is one of a pick-one set: main draws it as a radio, not a checkbox. */
  radioGroup?: string;
}

/** Every registered command's state, keyed by command id. */
export type MenuItemStates = Record<string, MenuItemState>;

/** The payload of `event:repoChanged`, which repository moved, and what moved in it. */
export interface RepoChange {
  /** The repository the command ran in: a worktree or submodule path for those. */
  path: string;
  facets: readonly RepoFacet[];
}

/** Main → renderer push channels. Each entry is the payload type. */
export interface Events {
  /** A git command started, or finished (the record is sent twice). */
  'event:gitCommand': GitCommandRecord;
  /**
   * What moved, sent on every command exit with its declared facets, and by the `.git`
   * watcher (as `ALL_FACETS`) for changes made outside the app.
   */
  'event:repoChanged': RepoChange;
  /** The OS or the user changed the effective colour scheme. */
  'event:theme': 'light' | 'dark';
  /**
   * Settings written by any window, broadcast so a preference takes effect regardless
   * of which window changed it.
   */
  'event:settings': Settings;
  /** A menu item was activated; payload is a command id from the registry. */
  'event:command': string;
  /** A coalesced instalment of a streaming revision-log read. */
  'event:logBatch': LogBatch;
  /** A coalesced instalment of a streaming git run: see `stream:start`. */
  'event:streamLine': GitStreamBatch;
  /**
   * Open this repository in this window: see `repo:openHere`. Its own event, not
   * `event:command`, since it carries a path and no registry command takes one.
   */
  'event:openRepo': string;
  /**
   * The window was focused. Nothing watches the working tree, so this is when a
   * file's contents are worth re-asking git about.
   */
  'event:windowFocus': void;
  /**
   * "Show in File Tree" ran from the commit dialog: switch to tree mode, select this
   * path. See `dialog:showInFileTree`.
   */
  'event:showInFileTree': string;
  /** The Advanced Filter dialog applied its session fields. See `dialog:applyLogFilter`. */
  'event:applyLogFilter': LogOptions;
  /**
   * The Go to Commit dialog resolved a revision: select it, or say why it's not on
   * screen. See `dialog:goToRevision`.
   */
  'event:goToRevision': string;
}

export type InvokeChannel = keyof Invocations;
export type EventChannel = keyof Events;

export type InvokeArgs<C extends InvokeChannel> = Parameters<Invocations[C]>;
export type InvokeResult<C extends InvokeChannel> = ReturnType<Invocations[C]>;

/**
 * Runtime list of invoke channels: TypeScript can't enumerate interface keys at
 * runtime, so this is the one duplication; the assertion below makes an omission fail.
 */
export const INVOKE_CHANNELS = [
  'settings:get',
  'settings:patch',
  'env:app',
  'env:git',
  'env:health',
  'env:locale',
  'repo:open',
  'repo:pick',
  'repo:info',
  'repo:state',
  'repo:status',
  'repo:watch',
  'repo:unwatch',
  'repo:openPath',
  'repo:openHere',
  'repo:forgetRecent',
  'repo:openWindow',
  'repo:showItemInFolder',
  'repo:openTerminal',
  'dialog:open',
  'dialog:openOutput',
  'dialog:close',
  'dialog:fit',
  'dialog:showInFileTree',
  'dialog:applyLogFilter',
  'dialog:goToRevision',
  'clipboard:read',
  'revisions:start',
  'revisions:cancel',
  'revisions:count',
  'revisions:details',
  'revisions:describe',
  'file:history',
  'file:blame',
  'search:grep',
  'diff:files',
  'diff:patch',
  'diff:saveFileAs',
  'stage:applyPatch',
  'stage:applyToWorkingTree',
  'stage:setIndexFlag',
  'stage:indexFlags',
  'stage:stopTracking',
  'file:delete',
  'file:ignoreRules',
  'file:readRepoText',
  'file:checkRepoText',
  'file:writeRepoText',
  'file:readWorkingText',
  'file:writeWorkingText',
  'file:addIgnoreRules',
  'file:openRevision',
  'file:difftool',
  'file:compareTwo',
  'file:openRevisionWith',
  'file:openWith',
  'file:chooseSavePath',
  'file:chooseDirectory',
  'file:choosePatch',
  'tree:list',
  'tree:blob',
  'conflicts:readBlobs',
  'conflicts:writeResolved',
  'conflicts:readSides',
  'refs:list',
  'refs:merged',
  'branch:stale',
  'remote:list',
  'stash:list',
  'worktree:list',
  'submodule:list',
  'submodule:status',
  'repo:aheadBehind',
  'repo:isAncestor',
  'remote:heads',
  'repo:revision',
  'repo:commitMessage',
  'repo:parents',
  'repo:validBranchName',
  'repo:config',
  'config:read',
  'config:write',
  'repo:deleteIndexLock',
  'repo:fsck',
  'file:readPatch',
  'log:list',
  'log:clear',
  'diagnostics:record',
  'diagnostics:save',
  'git:run',
  'stream:start',
  'stream:cancel',
  'stream:state',
  'git:writeMessageFile',
  'git:readMessageFile',
  'remote:setEnabled',
  'menu:state'
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'event:gitCommand',
  'event:repoChanged',
  'event:theme',
  'event:settings',
  'event:command',
  'event:logBatch',
  'event:streamLine',
  'event:windowFocus',
  'event:showInFileTree',
  'event:applyLogFilter',
  'event:goToRevision',
  'event:openRepo'
] as const satisfies readonly EventChannel[];

/**
 * Compile-time proof `INVOKE_CHANNELS` covers every `Invocations` key: an omission
 * fails to typecheck rather than failing at runtime.
 */
type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
type MissingEvent = Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>;
export type _AssertNoMissingInvoke = MissingInvoke extends never ? true : never;
export type _AssertNoMissingEvent = MissingEvent extends never ? true : never;
const _assertInvoke: _AssertNoMissingInvoke = true;
const _assertEvent: _AssertNoMissingEvent = true;
void _assertInvoke;
void _assertEvent;

/**
 * `window.git`'s shape, built by preload: mirrors `Invocations` but returns promises,
 * plus one subscribe function per event channel.
 */
export type GitApi = {
  [C in InvokeChannel]: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>;
} & {
  on<E extends EventChannel>(channel: E, listener: (payload: Events[E]) => void): () => void;
  /**
   * The filesystem path of a dropped `File`, or '' when it has none.
   *
   * Not an IPC channel: `webUtils.getPathForFile` is a synchronous preload-side call, and
   * it is the only way to read a drop's path since Electron 32 removed `File.path`.
   */
  pathForFile(file: File): string;
};
