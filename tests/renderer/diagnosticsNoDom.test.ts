/**
 * `renderer/diagnostics.ts` must work with no DOM.
 *
 * It is imported by the command registry and by the revision stores, and both of those
 * are loaded under Node: `menu.test.ts` and `commandHomes.test.ts` load the whole
 * registry to hold every command to having a home, and the store tests drive the stores
 * directly. Twice now a change here has broken that, and both times it surfaced as six
 * unrelated store tests failing with `window is not defined`, which says nothing about
 * where the fault is.
 *
 * So the rule gets its own test, named after itself. This file deliberately does *not*
 * opt into `happy-dom`: `window` being undefined is the whole point.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const record = vi.fn();

vi.mock('@renderer/api.js', () => ({
  api: {
    'diagnostics:record': (...args: unknown[]): Promise<void> =>
    {
      record(...args);
      return Promise.resolve();
    }
  }
}));

const { measure, noteTiming } = await import('@renderer/diagnostics.js');
const { observeCommands, defineCommand, runCommand } = await import('@renderer/commands/registry.js');

afterEach(() => record.mockClear());

describe('recording without a DOM', () =>
{
  it('has no `window` to reach for: the premise of every case here', () =>
  {
    expect(typeof globalThis.window).toBe('undefined');
  });

  it('records a timing', () =>
  {
    expect(() => noteTiming('graph layout', 104, ['17719 rows'])).not.toThrow();
    expect(record).toHaveBeenCalledOnce();
  });

  it('measures a piece of work and hands back its result', () =>
  {
    expect(measure('a thing', () => 42)).toBe(42);
    expect(record).toHaveBeenCalledOnce();
  });

  /** A `finally`, so work that throws is still timed and the throw still reaches the caller. */
  it('times work that throws, and rethrows it', () =>
  {
    const blowUp = (): never =>
    {
      throw new Error('boom');
    };
    expect(() => measure('a thing', blowUp)).toThrow('boom');
    expect(record).toHaveBeenCalledOnce();
  });

  /** The registry's own hook, which is how a command reaches the timeline at all. */
  it('runs a command through the observer the registry takes', async () =>
  {
    let ran = false;
    defineCommand({ id: 'test.noDom', label: 'No DOM', group: 'Tools', run: () =>
    {
      ran = true;
    } });

    const seen: string[] = [];
    observeCommands((id) => seen.push(id));
    await runCommand('test.noDom', { hasRepo: true } as never);

    expect(ran).toBe(true);
    expect(seen).toEqual(['test.noDom']);
  });
});
