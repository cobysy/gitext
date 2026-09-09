/**
 * Generic backoff retry. Caller provides the predicate and schedule; runner.ts adds
 * git-specific logic (transient error detection).
 */
export function delay(ms: number): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withBackoffRetry<T>(
  run: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean,
  backoffMs: readonly number[]
): Promise<T>
{
  for (let attempt = 0; ; attempt++)
  {
    try
    {
      return await run();
    }
    catch (err)
    {
      const wait = backoffMs[attempt];
      if (wait === undefined || !shouldRetry(err))
      {
        throw err;
      }
      await delay(wait);
    }
  }
}
