import { describe, expect, it } from 'vitest';
import { mapLimited } from '@main/mapLimited.js';

/** Settles after a macrotask, so the calls genuinely overlap. */
function later<T>(value: T, ms: number): Promise<T>
{
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function range(length: number): number[]
{
  return Array.from({ length }, (_, i) => i);
}

describe('mapLimited', () =>
{
  it('keeps the input order whatever order the calls finish in', async () =>
  {
    const out = await mapLimited([30, 5, 20, 1], 4, (ms) => later(ms * 2, ms));
    expect(out).toEqual([60, 10, 40, 2]);
  });

  it('never has more than the limit in flight, and does use the limit', async () =>
  {
    let inFlight = 0;
    let peak = 0;
    await mapLimited(range(20), 3, async (i) =>
    {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await later(i, 2);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
  });

  it('counts each settled call, once', async () =>
  {
    const counts: number[] = [];
    await mapLimited([3, 1, 2], 2, (ms) => later(ms, ms), { onSettled: (done) => counts.push(done) });
    expect(counts).toEqual([1, 2, 3]);
  });

  it('still runs every item one at a time when the limit is none', async () =>
  {
    expect(await mapLimited([1, 2, 3], 0, (n) => later(n * 10, 1))).toEqual([10, 20, 30]);
  });

  it('answers an empty list without calling anything', async () =>
  {
    expect(await mapLimited([], 4, () => Promise.reject(new Error('called')))).toEqual([]);
  });

  it('starts nothing new once a call has failed, and rejects with that failure', async () =>
  {
    const started: number[] = [];
    const answer = mapLimited(range(20), 2, async (i) =>
    {
      started.push(i);
      await later(i, 2);
      if (i === 1)
      {
        throw new Error('boom');
      }
    });
    await expect(answer).rejects.toThrow('boom');
    // Give a worker that ignored the failure the time to start everything left.
    await later(null, 60);
    expect(started.length).toBeLessThanOrEqual(3);
  });

  it('starts nothing new once its signal fires, and rejects with the reason', async () =>
  {
    const stop = new AbortController();
    const started: number[] = [];
    const answer = mapLimited(range(20), 2, async (i) =>
    {
      started.push(i);
      await later(i, 2);
    }, { onSettled: () => stop.abort(new Error('unwanted')), signal: stop.signal });
    await expect(answer).rejects.toThrow('unwanted');
    await later(null, 60);
    expect(started.length).toBeLessThanOrEqual(3);
  });

  it('settles only once every call it started has finished, failing or not', async () =>
  {
    let running = 0;
    const answer = mapLimited([1, 20, 20], 3, async (ms) =>
    {
      running += 1;
      await later(ms, ms);
      running -= 1;
      if (ms === 1)
      {
        throw new Error('boom');
      }
    });
    await expect(answer).rejects.toThrow('boom');
    expect(running).toBe(0);
  });

  it('reports no progress from calls that land after a failure', async () =>
  {
    const counts: number[] = [];
    const answer = mapLimited([1, 5, 5], 3, async (ms) =>
    {
      await later(ms, ms);
      if (ms === 1)
      {
        throw new Error('boom');
      }
    }, { onSettled: (done) => counts.push(done) });
    await expect(answer).rejects.toThrow('boom');
    await later(null, 30);
    expect(counts).toEqual([]);
  });

  it('reports no progress from calls that land after the signal fires', async () =>
  {
    const stop = new AbortController();
    const counts: number[] = [];
    const answer = mapLimited([1, 5, 5], 3, (ms) => later(ms, ms), {
      onSettled: (done) =>
      {
        counts.push(done);
        stop.abort(new Error('unwanted'));
      },
      signal: stop.signal
    });
    await expect(answer).rejects.toThrow('unwanted');
    await later(null, 30);
    expect(counts).toEqual([1]);
  });

  it('starts nothing at all on a signal that has already fired', async () =>
  {
    const stop = new AbortController();
    stop.abort(new Error('unwanted'));
    let calls = 0;
    const answer = mapLimited(range(5), 2, async () =>
    {
      calls += 1;
    }, { signal: stop.signal });
    await expect(answer).rejects.toThrow('unwanted');
    expect(calls).toBe(0);
  });
});
