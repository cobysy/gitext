/**
 * Retry read failures. Revision grid holds stale SHA during reload.
 * Object usually resolvable within a tick. Never writes.
 */
import { GIT_KIND_READ, type GitCommandKind, type GitCommandRecord } from '@shared/types.js';
import { GitError } from './gitError.js';
import { delay, withBackoffRetry } from './retry.js';

const RETRYABLE_READ_STDERR = [/^fatal: bad object /, /^fatal: unable to read tree /];

const READ_RETRY_BACKOFF_MS = [30, 100, 200];

function isRetryableReadError(err: unknown): boolean
{
  return err instanceof GitError && RETRYABLE_READ_STDERR.some((re) => re.test(err.stderr.trim()));
}

/** Retry non-streaming read with backoff. */
export function withReadRetry<T>(kind: GitCommandKind, run: () => Promise<T>): Promise<T>
{
  if (kind === GIT_KIND_READ)
  {
    return withBackoffRetry(run, isRetryableReadError, READ_RETRY_BACKOFF_MS);
  }
  else
  {
    return run();
  }
}

/**
 * Retry streaming read from beginning, only if nothing reached caller yet.
 * Bad-object fails before git writes.
 */
export function withStreamRetry(
  kind: GitCommandKind,
  attempt: (onEmit: () => void) => { done: Promise<GitCommandRecord>; cancel: () => void }
): { done: Promise<GitCommandRecord>; cancel: () => void }
{
  let cancelled = false;
  let cancelCurrent = (): void =>
  {};
  const cancel = (): void =>
  {
    cancelled = true;
    cancelCurrent();
  };

  const run = (attemptIndex: number): Promise<GitCommandRecord> =>
  {
    let emitted = false;
    const { done, cancel: childCancel } = attempt(() =>
    {
      emitted = true;
    });
    cancelCurrent = childCancel;
    return done.catch((err) =>
    {
      const wait = READ_RETRY_BACKOFF_MS[attemptIndex];
      if (
        cancelled ||
        emitted ||
        kind !== GIT_KIND_READ ||
        wait === undefined ||
        !isRetryableReadError(err)
      )
      {
        throw err;
      }
      return delay(wait).then(() => run(attemptIndex + 1));
    });
  };

  return { done: run(0), cancel };
}
