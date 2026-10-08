/**
 * Watch the git directories of open repos. All state changes land there;
 * avoids huge trees.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { join, relative } from 'node:path';
import { EventEmitter } from 'node:events';
import { cachedGitDirProbe, ignoredUnder } from './watchIgnore.js';

const DEBOUNCE_MS = 300;

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
    ignored: ignoredUnder(targets, cachedGitDirProbe()),
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
