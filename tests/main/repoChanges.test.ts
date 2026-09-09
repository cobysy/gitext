/**
 * Coalescing and echo suppression: the two rules that decide *when* a repository change
 * is announced.
 *
 * Both are timing, which is exactly what a driven tour cannot check: a second reload
 * arriving 500 ms later looks like the first one being slow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoChange } from '@shared/contract.js';
import {
  announce,
  beginWrite,
  endWrite,
  isEcho,
  noteAppWrite,
  resetRepoChanges
} from '@main/ipc/repoChanges.js';

const REPO = '/tmp/repo';
const OTHER = '/tmp/other';

describe('repoChanges', () =>
{
  let sent: RepoChange[];
  const emit = (change: RepoChange): void => void sent.push(change);

  beforeEach(() =>
  {
    vi.useFakeTimers();
    sent = [];
    resetRepoChanges();
  });

  afterEach(() =>
  {
    resetRepoChanges();
    vi.useRealTimers();
  });

  it('says nothing until the coalescing window closes', () =>
  {
    announce(REPO, ['head'], emit);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(1);
  });

  /**
   * The case this exists for: composite operations are the norm. A checkout that stashes
   * first is three commands, and announcing each one separately is three reloads, which
   * is the flashing the whole change exists to remove.
   */
  it('unions the facets of everything announced inside the window', () =>
  {
    announce(REPO, ['stashes', 'index'], emit);
    announce(REPO, ['head', 'worktree'], emit);
    announce(REPO, ['head'], emit);
    vi.advanceTimersByTime(100);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe(REPO);
    expect([...sent[0]!.facets].sort()).toEqual(['head', 'index', 'stashes', 'worktree']);
  });

  it('keeps repositories apart', () =>
  {
    announce(REPO, ['head'], emit);
    announce(OTHER, ['refs'], emit);
    vi.advanceTimersByTime(100);

    expect(sent).toHaveLength(2);
    expect(sent.map((change) => change.path).sort()).toEqual([OTHER, REPO]);
  });

  it('starts a fresh window after one has flushed', () =>
  {
    announce(REPO, ['head'], emit);
    vi.advanceTimersByTime(100);
    announce(REPO, ['refs'], emit);
    vi.advanceTimersByTime(100);

    expect(sent).toHaveLength(2);
    expect(sent[1]!.facets).toEqual(['refs']);
  });

  it('ignores an empty facet set', () =>
  {
    announce(REPO, [], emit);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([]);
  });

  /**
   * The window alone only ever covered the gap *between* two commands, one IPC round
   * trip. A `git checkout` over a large working tree runs for far longer than that, so
   * the stash in front of it announced a repository whose HEAD had not moved yet and
   * every window did the whole reload twice.
   */
  describe('holding while a write runs', () =>
  {
    it('waits for the command in flight rather than the clock', () =>
    {
      beginWrite(REPO);
      announce(REPO, ['stashes', 'index'], emit);
      vi.advanceTimersByTime(2000);
      expect(sent).toEqual([]);

      endWrite(REPO);
      vi.advanceTimersByTime(100);
      expect(sent).toHaveLength(1);
    });

    it('gathers the whole operation into the one announcement', () =>
    {
      // The stash: announced as it finishes, while the checkout is still to come.
      beginWrite(REPO);
      announce(REPO, ['stashes', 'index'], emit);
      endWrite(REPO);

      // The checkout, started inside the window the stash left open.
      vi.advanceTimersByTime(10);
      beginWrite(REPO);
      vi.advanceTimersByTime(700);
      announce(REPO, ['head', 'worktree'], emit);
      endWrite(REPO);
      vi.advanceTimersByTime(100);

      expect(sent).toHaveLength(1);
      expect([...sent[0]!.facets].sort()).toEqual(['head', 'index', 'stashes', 'worktree']);
    });

    it('holds only the repository being written to', () =>
    {
      beginWrite(REPO);
      announce(REPO, ['head'], emit);
      announce(OTHER, ['refs'], emit);
      vi.advanceTimersByTime(100);

      expect(sent).toHaveLength(1);
      expect(sent[0]!.path).toBe(OTHER);
    });

    it('waits for the last of two overlapping writes', () =>
    {
      beginWrite(REPO);
      beginWrite(REPO);
      announce(REPO, ['head'], emit);
      endWrite(REPO);
      vi.advanceTimersByTime(200);
      expect(sent).toEqual([]);

      endWrite(REPO);
      vi.advanceTimersByTime(100);
      expect(sent).toHaveLength(1);
    });
  });

  describe('echo suppression', () =>
  {
    it('recognises the watcher tick that follows our own write', () =>
    {
      noteAppWrite(REPO);
      expect(isEcho(REPO)).toBe(true);
    });

    it('does not silence a repository we did not write to', () =>
    {
      noteAppWrite(REPO);
      expect(isEcho(OTHER)).toBe(false);
    });

    it('says nothing about a repository with no write at all', () =>
    {
      expect(isEcho(REPO)).toBe(false);
    });

    /**
     * The bound has to comfortably exceed the watcher's own ~450 ms so the echo of a slow
     * write is still caught, and stop soon after so an outside change is not swallowed.
     */
    it('covers the watcher latency and then lets go', () =>
    {
      noteAppWrite(REPO);
      vi.advanceTimersByTime(500);
      expect(isEcho(REPO)).toBe(true);
      vi.advanceTimersByTime(600);
      expect(isEcho(REPO)).toBe(false);
    });
  });
});
