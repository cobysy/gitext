import { describe, expect, it } from 'vitest';
import { createLatestOnly } from '@main/ipc/latestOnly.js';

/** A piece of work that runs until it is told to finish, and reports what it saw. */
function gate(): { work: (signal: AbortSignal) => Promise<string>; finish: () => void; seen: AbortSignal[] }
{
  let release = (): void => undefined;
  const opened = new Promise<void>((resolve) =>
  {
    release = resolve;
  });
  const seen: AbortSignal[] = [];
  return {
    seen,
    finish: () => release(),
    work: async (signal) =>
    {
      seen.push(signal);
      await opened;
      signal.throwIfAborted();
      return 'answer';
    }
  };
}

/** Long enough for every microtask hop in `run` to have happened. */
function macrotask(): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createLatestOnly', () =>
{
  it('answers the work it ran', async () =>
  {
    const slots = createLatestOnly<number>();
    expect(await slots.run(1, () => Promise.resolve('done'))).toBe('done');
  });

  it('abandons the older work, which answers null rather than failing', async () =>
  {
    const slots = createLatestOnly<number>();
    const first = gate();
    const older = slots.run(1, first.work);
    await macrotask();
    const newer = slots.run(1, () => Promise.resolve('newer'));
    first.finish();
    expect(await older).toBeNull();
    expect(await newer).toBe('newer');
  });

  it('starts the newer work only once the older one has stopped', async () =>
  {
    const slots = createLatestOnly<number>();
    const first = gate();
    const second = gate();
    void slots.run(1, first.work);
    await macrotask();
    const newer = slots.run(1, second.work);
    await macrotask();
    expect(second.seen).toHaveLength(0);
    first.finish();
    await macrotask();
    expect(second.seen).toHaveLength(1);
    second.finish();
    expect(await newer).toBe('answer');
  });

  it('a work superseded while it waits answers null at once, and never starts', async () =>
  {
    const slots = createLatestOnly<number>();
    const first = gate();
    const second = gate();
    void slots.run(1, first.work);
    await macrotask();
    const middle = slots.run(1, second.work);
    const last = gate();
    const newest = slots.run(1, last.work);
    // The first is still running: the middle one must not wait for it to say no.
    expect(await middle).toBeNull();
    expect(second.seen).toHaveLength(0);
    // The newest waits for the one actually running, not for the middle one's answer.
    await macrotask();
    expect(last.seen).toHaveLength(0);
    first.finish();
    await macrotask();
    expect(last.seen).toHaveLength(1);
    last.finish();
    expect(await newest).toBe('answer');
  });

  it('leaves other keys alone', async () =>
  {
    const slots = createLatestOnly<number>();
    const first = gate();
    const one = slots.run(1, first.work);
    await macrotask();
    await slots.run(2, () => Promise.resolve('other'));
    expect(first.seen[0]!.aborted).toBe(false);
    first.finish();
    expect(await one).toBe('answer');
  });

  it('abandon stops the work without starting another', async () =>
  {
    const slots = createLatestOnly<number>();
    const first = gate();
    const one = slots.run(1, first.work);
    await macrotask();
    slots.abandon(1);
    first.finish();
    expect(await one).toBeNull();
  });

  it('still fails a work that failed on its own', async () =>
  {
    const slots = createLatestOnly<number>();
    await expect(slots.run(1, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
