/**
 * Watch the git directories of open repos. All state changes land there;
 * avoids huge trees.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { join, relative, sep } from 'node:path';
import { EventEmitter } from 'node:events';

const DEBOUNCE_MS = 300;

/**
 * Directories that churn without UI meaning. `fsmonitor--daemon` holds the cookie files
 * a repo on `core.fsmonitor` writes to prove its daemon is alive and caught up: one per
 * query, so a busy repo rewrites it constantly and none of it is repository state.
 */
const IGNORED_DIRECTORIES = ['objects', 'lfs', 'fsmonitor--daemon'];

/**
 * Files that churn. `fsmonitor--daemon.ipc` is not a file at all: it is the Unix socket
 * `git fsmonitor--daemon` listens on, and `fs.watch` on a socket fails outright with
 * `UNKNOWN` rather than quietly watching nothing.
 */
const IGNORED_FILES = ['COMMIT_EDITMSG', 'fsmonitor--daemon.ipc'];

const LOCK_SUFFIX = '.lock';

/**
 * Is path churn (relative to gitDir). Submodules/worktrees have different
 * git dir paths; pattern must handle all.
 */
export function isChurn(gitDir: string, path: string): boolean
{
  const inside = relative(gitDir, path);
  if (inside === '' || inside.startsWith('..'))
  {
    return false;
  }
  const [top = ''] = inside.split(sep);
  return (
    IGNORED_DIRECTORIES.includes(top) ||
    inside.endsWith(LOCK_SUFFIX) ||
    IGNORED_FILES.includes(inside)
  );
}

/**
 * Is path churn to any of the directories being watched. A linked worktree's git
 * directory sits *inside* the shared one, so a path can be read against either; churn to
 * one is churn, since the two views disagree only about how much of the path they see.
 */
export function isChurnIn(gitDirs: readonly string[], path: string): boolean
{
  return gitDirs.some((gitDir) => isChurn(gitDir, path));
}

interface Entry {
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
  refCount: number;
  /** What moved since the last tick, as `<event> <path>`: see `watcherEvents`. */
  moved: Set<string>;
}

/** How many moved paths a tick reports by name: enough to say what happened, not a listing. */
const MAX_MOVED = 20;

const entries = new Map<string, Entry>();

const CHANGED_EVENT = 'changed';
const WATCHER_EVENT_ALL = 'all';
const WATCHER_EVENT_ERROR = 'error';

/**
 * Emits `'changed'` with the repo path, debounced, and what moved under `.git`: `change
 * refs/heads/main`, `add MERGE_HEAD`. The second is for the diagnostics log, which
 * otherwise records a repository moving underneath the app as nothing at all.
 */
export const watcherEvents = new EventEmitter<{ changed: [string, string[]] }>();

/**
 * Start watching `repoPath`, or join an existing watch of it. `gitDirs` is every
 * directory its state can move in (`resolveWatchedGitDirs`): one for an ordinary clone
 * or a submodule, two for a linked worktree. The nested pair reports a change under the
 * worktree's own directory twice, which the debounce below collapses into the one tick
 * it always was.
 */
export function watchRepo(repoPath: string, gitDirs?: readonly string[]): void
{
  const existing = entries.get(repoPath);
  if (existing)
  {
    existing.refCount++;
    return;
  }

  let targets: string[];
  if (gitDirs && gitDirs.length > 0)
  {
    targets = [...gitDirs];
  }
  else
  {
    targets = [join(repoPath, '.git')];
  }
  const watcher = chokidar.watch(targets, {
    ignored: (path: string) => isChurnIn(targets, path),
    ignoreInitial: true,
    // Wait for writes to settle; git rewrites refs and the index in bursts.
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    depth: 3
  });

  const entry: Entry = { watcher, timer: null, refCount: 1, moved: new Set() };
  entries.set(repoPath, entry);

  const fire = (event: string, path: string): void =>
  {
    if (entry.moved.size < MAX_MOVED)
    {
      entry.moved.add(`${event} ${relative(repoPath, path)}`);
    }
    if (entry.timer)
    {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() =>
    {
      entry.timer = null;
      const moved = [...entry.moved];
      entry.moved.clear();
      watcherEvents.emit(CHANGED_EVENT, repoPath, moved);
    }, DEBOUNCE_MS);
  };

  watcher.on(WATCHER_EVENT_ALL, fire);
  watcher.on(WATCHER_EVENT_ERROR, (err) => console.error(`Watcher error for ${repoPath}:`, err));
}

export function unwatchRepo(repoPath: string): void
{
  const entry = entries.get(repoPath);
  if (!entry)
  {
    return;
  }

  entry.refCount--;
  if (entry.refCount > 0)
  {
    return;
  }

  if (entry.timer)
  {
    clearTimeout(entry.timer);
  }
  void entry.watcher.close();
  entries.delete(repoPath);
}

export function closeAllWatchers(): void
{
  for (const [path] of entries)
  {
    const entry = entries.get(path);
    if (entry?.timer)
    {
      clearTimeout(entry.timer);
    }
    void entry?.watcher.close();
  }
  entries.clear();
}
