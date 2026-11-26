/**
 * One piece of work per key, the newest: starting another under the same key abandons
 * the one before it, and waits for it to stop before starting. For a read a window can
 * ask again before the last answer arrives, where the older answer is already unwanted
 * and only costs subprocesses, so two of them never run side by side.
 */

export interface LatestOnly<K> {
  /**
   * Run `work` as `key`'s only work. Resolves `null` when it is abandoned, by a newer
   * `run` or by `abandon`: an expected end, not a failure worth reporting as one.
   */
  run<T>(key: K, work: (signal: AbortSignal) => Promise<T>): Promise<T | null>;
  /** Abandon whatever `key` has running, and start nothing in its place. */
  abandon(key: K): void;
}

interface Running {
  controller: AbortController;
  /**
   * Settles when this work and every one queued before it have stopped: never rejects.
   * The whole chain, not this work alone, because one abandoned while still waiting
   * answers at once, and the work after it must still wait for the one actually running.
   */
  stopped: Promise<void>;
}

function ignore(): void
{
  // The outcome belongs to the work's own caller; this only waits for it.
}

/** Settles when `stopped` does or `signal` fires, whichever is first, leaving no listener. */
function stoppedOrAborted(stopped: Promise<void>, signal: AbortSignal): Promise<void>
{
  if (signal.aborted)
  {
    return Promise.resolve();
  }
  return new Promise((resolve) =>
  {
    function settle(): void
    {
      signal.removeEventListener('abort', settle);
      resolve();
    }
    signal.addEventListener('abort', settle);
    void stopped.then(settle);
  });
}

export function createLatestOnly<K>(): LatestOnly<K>
{
  const running = new Map<K, Running>();

  /** Wait for what came before, unless this work is abandoned first: then answer at once. */
  async function startAfter<T>(
    previous: Running | undefined,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T>
  {
    if (previous)
    {
      await stoppedOrAborted(previous.stopped, signal);
    }
    signal.throwIfAborted();
    return work(signal);
  }

  return {
    async run(key, work)
    {
      const previous = running.get(key);
      previous?.controller.abort();
      const controller = new AbortController();
      const answer = startAfter(previous, controller.signal, work);
      const stopped = Promise.all([previous?.stopped, answer.then(ignore, ignore)]).then(ignore);
      running.set(key, { controller, stopped });
      try
      {
        return await answer;
      }
      catch (e)
      {
        if (controller.signal.aborted)
        {
          return null;
        }
        throw e;
      }
      finally
      {
        if (running.get(key)?.controller === controller)
        {
          running.delete(key);
        }
      }
    },
    abandon(key)
    {
      running.get(key)?.controller.abort();
    }
  };
}
