/**
 * The back/forward trail through visited commits.
 *
 * The whole store is cursor arithmetic, and every way of getting it wrong looks the
 * same from outside: a Back that goes somewhere unexpected, or a Forward that has
 * quietly lost its trail. The case that matters most is the one that is hardest to
 * click: that going back does not itself record a visit, which is what would otherwise
 * make Back oscillate between two commits forever.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNavigationStore } from '@renderer/stores/navigation.js';

beforeEach(() =>
{
  setActivePinia(createPinia());
});

describe('recording visits', () =>
{
  it('starts empty, with nowhere to go', () =>
  {
    const nav = useNavigationStore();
    expect(nav.current).toBeNull();
    expect(nav.canGoBack).toBe(false);
    expect(nav.canGoForward).toBe(false);
    expect(nav.back()).toBeNull();
    expect(nav.forward()).toBeNull();
  });

  it('ignores a repeat of the commit already current', () =>
  {
    const nav = useNavigationStore();
    nav.visit('a');
    nav.visit('a');
    nav.visit('a');
    expect(nav.entries).toEqual(['a']);
    expect(nav.canGoBack).toBe(false);
  });

  it('ignores a null selection', () =>
  {
    const nav = useNavigationStore();
    nav.visit('a');
    nav.visit(null);
    expect(nav.entries).toEqual(['a']);
  });
});

describe('walking the trail', () =>
{
  it('goes back and forward over the visited commits', () =>
  {
    const nav = useNavigationStore();
    nav.visit('a');
    nav.visit('b');
    nav.visit('c');

    expect(nav.back()).toBe('b');
    expect(nav.back()).toBe('a');
    expect(nav.canGoBack).toBe(false);
    expect(nav.back()).toBeNull();

    expect(nav.forward()).toBe('b');
    expect(nav.forward()).toBe('c');
    expect(nav.canGoForward).toBe(false);
    expect(nav.forward()).toBeNull();
  });

  it('does not record the destination of its own Back', () =>
  {
    // The selection watcher calls `visit` with whatever Back just selected. If that
    // were recorded, the trail would grow a duplicate and the next Back would land
    // back where it started: the oscillation this rule exists to prevent.
    const nav = useNavigationStore();
    nav.visit('a');
    nav.visit('b');
    nav.visit('c');

    const target = nav.back();
    nav.visit(target);

    expect(nav.entries).toEqual(['a', 'b', 'c']);
    expect(nav.back()).toBe('a');
  });

  it('discards the forward trail once somewhere new is visited', () =>
  {
    const nav = useNavigationStore();
    nav.visit('a');
    nav.visit('b');
    nav.visit('c');
    nav.back();

    nav.visit('d');

    expect(nav.entries).toEqual(['a', 'b', 'd']);
    expect(nav.canGoForward).toBe(false);
    expect(nav.back()).toBe('b');
  });
});

describe('bounds', () =>
{
  it('caps the trail and keeps the newest end of it', () =>
  {
    const nav = useNavigationStore();
    for (let i = 0; i < 150; i++)
    {
      nav.visit(`sha-${i}`);
    }

    expect(nav.entries).toHaveLength(100);
    expect(nav.current).toBe('sha-149');
    expect(nav.entries[0]).toBe('sha-50');
    // The cursor has to follow the window down; left where it was it would point past
    // the end of a trimmed list.
    expect(nav.cursor).toBe(99);
  });

  it('resets for a different repository', () =>
  {
    const nav = useNavigationStore();
    nav.visit('a');
    nav.visit('b');

    nav.reset();

    expect(nav.entries).toEqual([]);
    expect(nav.current).toBeNull();
    expect(nav.canGoBack).toBe(false);
    // A visit after a reset starts a fresh trail rather than continuing the old one.
    nav.visit('c');
    expect(nav.entries).toEqual(['c']);
  });
});
