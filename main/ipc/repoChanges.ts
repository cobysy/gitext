/**
 * Telling every window that the repository moved: the moment it moved. Two ways to find
 * out: a command this app ran (`runner.ts` records every invocation, exact and fast), or
 * a change made outside the app, which the `.git` watcher notices ~450ms later and
 * reports as everything. Split out of `ipc/index.ts`: coalescing and echo suppression are one coherent job.
 */

import type { RepoChange } from '@shared/contract.js';
import type { RepoFacet } from '@shared/invalidation.js';

/**
 * How long to gather facets before announcing them. Not an optimisation: composite
 * operations are the norm (`buildCheckoutSteps` is up to three commands), and without
 * this a checkout that stashes first would reload the window three times. Short enough to stay imperceptible.
 *
 * On its own it only covers the gap *between* two commands, which is one IPC round
 * trip. It cannot cover a command that takes half a second to run, which is why
 * `beginWrite`/`endWrite` hold the announcement as well: see `announce`.
 */
const COALESCE_MS = 50;

/**
 * How long an app-initiated write suppresses the watcher's echo of it. The watcher
 * fires for our own writes too, a second wider refresh for a change already announced
 * exactly. Trade-off: an outside change landing inside this window is missed until the
 * next focus or F5. Must comfortably exceed the watcher's own ~450ms.
 */
const ECHO_MS = 1000;

interface Pending {
  facets: Set<RepoFacet>;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
/** When this app last wrote to each repository, for `isEcho`. */
const lastWrite = new Map<string, number>();
/** Writes in flight per repository, for the hold in `announce`. */
const writing = new Map<string, number>();

/**
 * Announce that `repoPath` changed, gathering everything announced within
 * `COALESCE_MS` into one message. `emit` is injected, not imported, so this module never reaches for Electron; `ipc/index.ts` owns the broadcast.
 *
 * **A repository is not announced while a write against it is still running.** Each
 * command of a composite operation declares the operation's whole facet set, so the
 * first to finish would announce a repository the rest of the operation has yet to
 * move: a checkout that stashes first announced twice, and every window did the whole
 * reload twice, the first time against a HEAD that had not moved yet. `COALESCE_MS`
 * cannot cover that on its own, being far shorter than a `git checkout` over a large
 * working tree. So the timer re-arms while `writing` says a command is in flight, and
 * what it waits for between two of them is the IPC round trip the window needs to start
 * the next.
 */
export function announce(
  repoPath: string,
  facets: readonly RepoFacet[],
  emit: (change: RepoChange) => void
): void
{
  if (facets.length === 0)
  {
    return;
  }

  const existing = pending.get(repoPath);
  if (existing)
  {
    for (const facet of facets)
    {
      existing.facets.add(facet);
    }
    return;
  }

  const flush = (): void =>
  {
    if ((writing.get(repoPath) ?? 0) > 0)
    {
      entry.timer = setTimeout(flush, COALESCE_MS);
      return;
    }
    pending.delete(repoPath);
    emit({ path: repoPath, facets: [...entry.facets] });
  };

  const entry: Pending = {
    facets: new Set(facets),
    timer: setTimeout(flush, COALESCE_MS)
  };
  pending.set(repoPath, entry);
}

/**
 * A write against `repoPath` has started, and no announcement should call the
 * repository settled until it ends. Paired with `endWrite` in a `finally`: a count
 * rather than a flag, since two operations can overlap.
 */
export function beginWrite(repoPath: string): void
{
  writing.set(repoPath, (writing.get(repoPath) ?? 0) + 1);
}

export function endWrite(repoPath: string): void
{
  const count = (writing.get(repoPath) ?? 0) - 1;
  if (count > 0)
  {
    writing.set(repoPath, count);
  }
  else
  {
    writing.delete(repoPath);
  }
}

/** Record that this app wrote to `repoPath`, so the watcher can recognise its own echo. */
export function noteAppWrite(repoPath: string): void
{
  lastWrite.set(repoPath, Date.now());
}

/** Whether a watcher tick for `repoPath` is the echo of a write this app just made: already announced with exact facets, so the watcher's version is a wasted wider reload. */
export function isEcho(repoPath: string): boolean
{
  const at = lastWrite.get(repoPath);
  return at !== undefined && Date.now() - at < ECHO_MS;
}

/** Drop every pending announcement: for shutdown, and to keep tests isolated. */
export function resetRepoChanges(): void
{
  for (const entry of pending.values())
  {
    clearTimeout(entry.timer);
  }
  pending.clear();
  lastWrite.clear();
  writing.clear();
}
