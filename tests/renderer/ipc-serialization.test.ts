/**
 * Everything crossing IPC must survive the structured clone algorithm.
 *
 * This is not theoretical. `ref({ … })` wraps an object in a deep reactive proxy,
 * and structured clone reads internal slots rather than going through proxy traps,
 * so it rejects a proxy with `DataCloneError`. Passing store state straight to an
 * `api.*` call therefore fails at runtime with an error that says nothing about
 * reactivity, and if the caller does not await it, the UI simply hangs.
 *
 * `renderer/api.ts` unwraps arguments at the boundary. These tests pin the property
 * that unwrapping has to provide.
 */

import { describe, expect, it } from 'vitest';
import { reactive, ref, toRaw } from 'vue';
import type { LogOptions } from '@shared/types.js';

/**
 * The unwrapping `renderer/api.ts` applies. Duplicated here rather than imported
 * because that module reaches for `window.git`, which does not exist under Node.
 */
function toPlain<T>(value: T): T
{
  const raw = toRaw(value);
  if (raw === null || typeof raw !== 'object')
  {
    return raw;
  }
  if (Array.isArray(raw))
  {
    return raw.map((item) => toPlain(item)) as T;
  }

  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null)
  {
    return raw as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>))
  {
    out[key] = toPlain(item);
  }
  return out as T;
}

describe('reactive values and structured clone', () =>
{
  it('confirms a reactive object cannot be cloned: the bug this guards', () =>
  {
    const options = ref<LogOptions>({ scope: 'current', order: 'date', limit: 999999 });
    expect(() => structuredClone(options.value)).toThrow();
  });

  it('makes a reactive object cloneable', () =>
  {
    const options = ref<LogOptions>({ scope: 'current', order: 'date', limit: 999999 });
    expect(() => structuredClone(toPlain(options.value))).not.toThrow();
  });

  it('preserves the values it unwraps', () =>
  {
    const options = ref<LogOptions>({
      scope: 'filtered',
      refs: ['main', 'origin/dev'],
      limit: 500,
      useRegex: true
    });

    expect(toPlain(options.value)).toEqual({
      scope: 'filtered',
      refs: ['main', 'origin/dev'],
      limit: 500,
      useRegex: true
    });
  });

  it('unwraps a nested reactive array, not just the top level', () =>
  {
    // `refs` is itself a proxy when reached through the parent, so a shallow
    // toRaw would leave it reactive and the clone would still fail.
    const options = ref<LogOptions>({ scope: 'filtered', refs: ['main'] });
    const plain = toPlain(options.value);

    expect(() => structuredClone(plain)).not.toThrow();
    expect(plain.refs).toEqual(['main']);
  });

  it('unwraps a reactive() object as well as a ref', () =>
  {
    const options = reactive<LogOptions>({ scope: 'all', paths: ['src/main.ts'] });
    expect(() => structuredClone(toPlain(options))).not.toThrow();
  });

  it('leaves plain values untouched', () =>
  {
    expect(toPlain(42)).toBe(42);
    expect(toPlain('main')).toBe('main');
    expect(toPlain(null)).toBe(null);
    expect(toPlain(undefined)).toBe(undefined);
  });

  it('does not flatten a Date into an empty object', () =>
  {
    // Structured clone handles Dates natively; rebuilding one field by field
    // would destroy it.
    const when = new Date('2026-01-01T00:00:00Z');
    expect(toPlain({ when }).when.getTime()).toBe(when.getTime());
  });

  it('survives an argument list mixing reactive and plain values', () =>
  {
    const args = [1, '/repo/path', ref<LogOptions>({ scope: 'all' }).value];
    expect(() => structuredClone(args.map((a) => toPlain(a)))).not.toThrow();
  });
});
