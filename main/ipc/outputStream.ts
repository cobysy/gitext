/**
 * A git run whose *output* is the point: batching `streamGit`'s lines for the renderer
 * and keeping track of which run is still current. Sibling of `./revisionStream.ts`,
 * differing only in what's streamed. Exists because `git:run` can't express `gc` or
 * `fsck --lost-found`: each takes as long as it takes and is worth stopping, which a
 * promise resolving with a string can't say. Also carries stderr, which `runGit` drops.
 */

import type { RepoFacet } from '@shared/invalidation.js';
import type { GitStreamBatch, StreamState } from '@shared/types.js';
import { streamGit } from '@main/git/runner.js';

/** How long lines accumulate before being sent to the renderer: the same 50ms the revision log uses, since `fsck --unreachable` can print thousands of lines. */
const OUTPUT_BATCH_INTERVAL_MS = 50;

const EVENT_STREAM_LINE = 'event:streamLine';

interface ActiveRun {
  cancel: () => void;
  timer: NodeJS.Timeout | null;
  pending: string[];
  /** The line git is still writing: see `GitStreamBatch.partial`. */
  partial: string;
}

/**
 * How many finished runs stay readable. The console window opens *while* its run is
 * already going, and a quick command can be over before that window has mounted and
 * subscribed: without something to catch up from, it would sit there watching a run
 * that had already ended. A handful is enough for the longest operation anyone runs in
 * one go, and each holds only the lines the command printed.
 */
const RETAINED_RUNS = 8;

export interface OutputStream {
  /** Start (or replace) a streaming run for `requestId`. Fire-and-forget by design. */
  start(requestId: number, repoPath: string, argv: string[], facets: readonly RepoFacet[]): void;
  cancel(requestId: number): void;
  /** What a run has said so far, for a window that subscribed after it started. */
  state(requestId: number): StreamState | null;
}

/** An output stream, broadcasting through `broadcast` and announcing invalidations through `changed`: this module has no business knowing how a change is announced. */
export function createOutputStream(
  broadcast: (channel: string, payload: GitStreamBatch) => void,
  changed: (repoPath: string, facets: readonly RepoFacet[]) => void
): OutputStream
{
  /** In-flight runs, keyed by the renderer's request id. */
  const activeRuns = new Map<number, ActiveRun>();

  /**
   * Everything each run has said, in insertion order so the oldest is the first to go.
   * Written on every batch, read by `state`: see `RETAINED_RUNS`.
   */
  const history = new Map<number, StreamState>();

  /** Record a batch as it goes out, and keep the history within its bound. */
  function retain(requestId: number, batch: GitStreamBatch): void
  {
    let kept = history.get(requestId);
    if (!kept)
    {
      kept = { lines: [], done: false };
      history.set(requestId, kept);
      // Insertion order, so the first key is the oldest run.
      while (history.size > RETAINED_RUNS)
      {
        const oldest = history.keys().next();
        if (oldest.done)
        {
          break;
        }
        history.delete(oldest.value);
      }
    }
    kept.lines.push(...batch.lines);
    kept.partial = batch.partial;
    if (batch.done)
    {
      kept.done = true;
      kept.exitCode = batch.exitCode ?? null;
      kept.error = batch.error;
    }
  }

  /** True when `run` exists and, if a specific run was named, is that one. */
  function isCurrentRun(run: ActiveRun | undefined, only: ActiveRun | undefined): run is ActiveRun
  {
    return !!run && (!only || run === only);
  }

  /** Retire a run, but only if it's still the one registered under its id: keeps a superseded run from deleting the entry its replacement now owns. */
  function finishRun(requestId: number, only?: ActiveRun): void
  {
    const run = activeRuns.get(requestId);
    if (!isCurrentRun(run, only))
    {
      return;
    }
    if (run.timer)
    {
      clearTimeout(run.timer);
    }
    activeRuns.delete(requestId);
  }

  async function startRun(
    requestId: number,
    repoPath: string,
    argv: string[],
    facets: readonly RepoFacet[]
  ): Promise<void>
  {
    // A new run for the same id replaces the old one rather than racing it.
    activeRuns.get(requestId)?.cancel();
    finishRun(requestId);

    const run: ActiveRun = { cancel: () =>
    {}, timer: null, pending: [], partial: '' };
    activeRuns.set(requestId, run);

    const flush = (done: boolean, exitCode?: number | null, error?: string): void =>
    {
      // Clear first: an early return that left the handle set would stop `??=` from ever scheduling again, stalling the stream part-way through.
      run.timer = null;

      // Nothing to say unless there are lines, a partial line that moved, or this is
      // the closing message.
      if (run.pending.length === 0 && !run.partial && !done)
      {
        return;
      }

      const lines = run.pending;
      run.pending = [];
      let finalExitCode: number | null | undefined;
      if (done)
      {
        finalExitCode = exitCode ?? null;
      }
      else
      {
        finalExitCode = undefined;
      }
      let finalError: string | undefined;
      if (error)
      {
        finalError = error;
      }
      else
      {
        finalError = undefined;
      }
      // Cleared on the way out: once the run is over there is no line still being
      // written, and its last state has already arrived in `lines`.
      let partial: string | undefined;
      if (!done && run.partial)
      {
        partial = run.partial;
      }
      const batch: GitStreamBatch = {
        requestId,
        lines,
        done,
        exitCode: finalExitCode,
        error: finalError,
        partial
      };
      retain(requestId, batch);
      broadcast(EVENT_STREAM_LINE, batch);
    };

    // `allowFailure`, since for this channel a non-zero exit is *information*, not a
    // failure: a damaged repository's `fsck` exits non-zero having printed exactly the
    // report the window opened to read. The exit code goes in the closing batch instead.
    // `kind` is left to `classify`: `gc`/`prune` are writes, `fsck` isn't.
    const { done, cancel } = streamGit(
      repoPath,
      argv,
      (line) =>
      {
        // Compared by *identity*, not key: a superseded run's replacement sits under the same id, so a dead run would go on emitting and end its spinner early.
        if (activeRuns.get(requestId) !== run)
        {
          return;
        }
        // The line ended: it belongs in the output proper, and there is no partial
        // one until git starts the next.
        run.pending.push(line);
        run.partial = '';
        run.timer ??= setTimeout(() => flush(false), OUTPUT_BATCH_INTERVAL_MS);
      },
      { allowFailure: true },
      (partial) =>
      {
        if (activeRuns.get(requestId) !== run)
        {
          return;
        }
        run.partial = partial;
        run.timer ??= setTimeout(() => flush(false), OUTPUT_BATCH_INTERVAL_MS);
      }
    );
    run.cancel = cancel;

    try
    {
      const record = await done;
      if (activeRuns.get(requestId) === run)
      {
        if (run.timer)
        {
          clearTimeout(run.timer);
        }
        flush(true, record.exitCode);
      }
    }
    catch (error)
    {
      // Reached only when git could not be spawned at all: `allowFailure` covers every exit code, so there's no other way here.
      if (activeRuns.get(requestId) === run)
      {
        if (run.timer)
        {
          clearTimeout(run.timer);
        }
        let message: string;
        if (error instanceof Error)
        {
          message = error.message;
        }
        else
        {
          message = String(error);
        }
        flush(true, null, message);
      }
    }
    finally
    {
      finishRun(requestId, run);
      // In a `finally`: a `gc` that failed half way through has still rewritten part of the object database, and a cancelled one certainly has.
      changed(repoPath, facets);
    }
  }

  return {
    start(requestId, repoPath, argv, facets)
    {
      // Deliberately not awaited: the run reports through `event:streamLine`, so the renderer's call returns as soon as the process is running.
      void startRun(requestId, repoPath, argv, facets);
    },
    cancel(requestId)
    {
      // Killed but deliberately left in the map: `streamGit`'s `done` still settles after
      // the kill, and the closing batch is what stops the renderer's spinner. `finishRun` in the `finally` removes it.
      activeRuns.get(requestId)?.cancel();
    },
    state(requestId)
    {
      const kept = history.get(requestId);
      if (!kept)
      {
        return null;
      }
      // A copy: the caller is another process's worth of JSON, and this record is still
      // being appended to.
      return { ...kept, lines: [...kept.lines] };
    }
  };
}
