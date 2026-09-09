/**
 * Revision log's IPC-facing stream: batches output, tracks current request.
 * Dependency-light: broadcast is a parameter (testable without ipcMain/BrowserWindow).
 */

import type { CommitRow, LogOptions } from '@shared/types.js';
import { getRemoteNames } from '@main/git/remote.js';
import { streamLog } from '@main/git/log.js';

/**
 * Batch commits before IPC: one flush per frame keeps message count proportional to time.
 */
const LOG_BATCH_INTERVAL_MS = 50;

const EVENT_LOG_BATCH = 'event:logBatch';

interface ActiveRead {
  cancel: () => void;
  timer: NodeJS.Timeout | null;
  pending: CommitRow[];
}

export interface RevisionStream {
  /**
   * Start (or replace) a streaming read for `requestId` in `windowId`. Fire-and-forget.
   *
   * The window is part of the identity, not decoration: every renderer starts its own
   * request counter at 1, so two repository windows both ask for request 1 and, keyed by
   * the number alone, the second one cancelled the first one's read and then received its
   * commits.
   */
  start(windowId: number, requestId: number, repoPath: string, options: LogOptions): void;
  cancel(windowId: number, requestId: number): void;
}

/** What a batch is broadcast as: `event:logBatch`'s payload. */
interface LogBatchEvent {
  requestId: number;
  commits: CommitRow[];
  done: boolean;
  error?: string;
}

/**
 * Revision stream using caller's broadcast (same sender as event:gitCommand/event:repoChanged).
 */
export function createRevisionStream(
  send: (windowId: number, channel: string, payload: LogBatchEvent) => void
): RevisionStream
{
  /** In-flight log reads, keyed by window and the renderer's request id within it. */
  const activeReads = new Map<string, ActiveRead>();

  /** Request ids are per-renderer, so the window has to be part of the key. */
  function keyOf(windowId: number, requestId: number): string
  {
    return `${windowId}:${requestId}`;
  }

  function finishRead(key: string): void
  {
    const read = activeReads.get(key);
    if (read?.timer)
    {
      clearTimeout(read.timer);
    }
    activeReads.delete(key);
  }

  async function startRevisionRead(
    windowId: number,
    requestId: number,
    repoPath: string,
    options: LogOptions
  ): Promise<void>
  {
    const key = keyOf(windowId, requestId);
    // A new read for the same id replaces the old one rather than racing it.
    activeReads.get(key)?.cancel();
    finishRead(key);

    const remotes = await getRemoteNames(repoPath);
    const read: ActiveRead = { cancel: () =>
    {}, timer: null, pending: [] };
    activeReads.set(key, read);

    const flush = (done: boolean, error?: string): void =>
    {
      // Clear first: an early return that left the handle set would stop `??=` from
      // ever scheduling again, stalling the stream part-way through.
      read.timer = null;

      // Nothing to say unless there are commits or this is the closing message.
      if (read.pending.length === 0 && !done)
      {
        return;
      }

      const commits = read.pending;
      read.pending = [];
      let finalError: string | undefined;
      if (error)
      {
        finalError = error;
      }
      else
      {
        finalError = undefined;
      }
      // To the window that asked, not to every window: a dialog and a console have no use
      // for a log batch, and another repository window actively must not see it.
      send(windowId, EVENT_LOG_BATCH, { requestId, commits, done, error: finalError });
    };

    const { done, cancel } = streamLog(
      repoPath,
      options,
      (commits) =>
      {
        // Only a superseded read is missing from the map; drop its output.
        if (!activeReads.has(key))
        {
          return;
        }
        // A loop, not `push(...commits)`: the spread passes every commit as an argument,
        // and a fast stream on a large history can exceed V8's argument limit and throw
        // `RangeError` in the middle of a read.
        for (const commit of commits)
        {
          read.pending.push(commit);
        }
        read.timer ??= setTimeout(() => flush(false), LOG_BATCH_INTERVAL_MS);
      },
      remotes
    );
    read.cancel = cancel;

    try
    {
      await done;
      if (activeReads.has(key))
      {
        if (read.timer)
        {
          clearTimeout(read.timer);
        }
        flush(true);
      }
    }
    catch (error)
    {
      if (activeReads.has(key))
      {
        if (read.timer)
        {
          clearTimeout(read.timer);
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
        flush(true, message);
      }
    }
    finally
    {
      finishRead(key);
    }
  }

  return {
    start(windowId, requestId, repoPath, options)
    {
      // Deliberately not awaited: the read reports through `event:logBatch`, so the
      // renderer's call returns as soon as the stream is running.
      void startRevisionRead(windowId, requestId, repoPath, options);
    },
    cancel(windowId, requestId)
    {
      const key = keyOf(windowId, requestId);
      activeReads.get(key)?.cancel();
      finishRead(key);
    }
  };
}

export type { LogBatchEvent };
