/**
 * Map over a list with a bounded number of calls in flight, keeping the input's order.
 *
 * For work that is one subprocess chain per item: run one at a time it waits on each
 * spawn in turn, and run all at once a list of a thousand forks a thousand processes.
 *
 * Stops taking items the moment the answer is decided without them: one call has
 * failed, which is the whole answer, or `signal` has fired, because nobody wants it any
 * more. Calls already running finish, since a spawned git is not worth killing midway,
 * and the map settles only once they have: when it answers, nothing it started is running.
 */

export interface MapLimitedOptions {
  /** Called as each call settles, with how many have so far: never once the map is over. */
  onSettled?: (done: number) => void;
  /** Abandons the map: no new item starts, and it rejects with the signal's reason. */
  signal?: AbortSignal;
}

export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
  { onSettled, signal }: MapLimitedOptions = {}
): Promise<R[]>
{
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  let failed = false;

  /** Its answer is already decided: a call failed, or nobody wants it any more. */
  function isOver(): boolean
  {
    return failed || Boolean(signal?.aborted);
  }

  async function worker(): Promise<void>
  {
    while (next < items.length && !isOver())
    {
      const index = next;
      next += 1;
      try
      {
        results[index] = await work(items[index]!);
      }
      catch (e)
      {
        failed = true;
        throw e;
      }
      done += 1;
      // A call landing after the map is over counts nothing anyone is still reading.
      if (!isOver())
      {
        onSettled?.(done);
      }
    }
  }

  signal?.throwIfAborted();
  // At least one: a limit of none would start nothing and answer a list of holes.
  const width = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: width }, worker);
  // Settled, never `Promise.all`: that answers at the first failure while the other
  // workers are still in their calls, and a caller told "stopped" would start more.
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure)
  {
    throw failure.reason;
  }
  signal?.throwIfAborted();
  return results;
}
