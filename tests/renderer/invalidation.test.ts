/**
 * The renderer half of targeted refresh: facets in, reloads out.
 *
 * Worth unit-testing rather than driving, because the interesting cases are the ones you
 * cannot see: a checkout that correctly *does not* re-stream the log looks exactly like
 * one that forgot to.
 */

import { describe, expect, it } from 'vitest';
import {
  applyInvalidation,
  isEveryFacet,
  headMoved,
  needsLogReload,
  type InvalidationHandler,
  type LogScope
} from '@renderer/composables/useRepoInvalidation.js';
import { ALL_FACETS, CHECKOUT, HISTORY_MOVE, READS, REFS, STAGING } from '@shared/invalidation.js';

/** Handlers that record which ones ran, in order. */
function spy(): { handlers: InvalidationHandler[]; ran: string[] }
{
  const ran: string[] = [];
  return {
    ran,
    handlers: [
      { facets: ['head', 'refs', 'worktree', 'index'], run: () => ran.push('repo') },
      {
        facets: ['head', 'refs', 'stashes', 'remotes', 'submodules', 'worktrees', 'config'],
        run: () => ran.push('objects')
      },
      { facets: ['worktree', 'index'], run: () => ran.push('diff') },
      { facets: ['worktree'], run: () => ran.push('tree') }
    ]
  };
}

describe('applyInvalidation', () =>
{
  it('runs nothing for a read', () =>
  {
    const { handlers, ran } = spy();
    applyInvalidation(READS, handlers);
    expect(ran).toEqual([]);
  });

  it('runs a handler once however many of its facets changed', () =>
  {
    const { handlers, ran } = spy();
    // `head`, `refs`, `worktree` and `index` all want the repo store; it must reload once.
    applyInvalidation(HISTORY_MOVE, handlers);
    expect(ran.filter((name) => name === 'repo')).toHaveLength(1);
  });

  it('runs only the handlers the facets touch', () =>
  {
    const { handlers, ran } = spy();
    applyInvalidation(STAGING, handlers);
    // The index moved: the status and the diff are stale, the panel and the tree are not.
    expect(ran).toEqual(['repo', 'diff']);
  });

  /**
   * Which branch the panel marks as current is `RefEntry.isCurrent`, filled in by
   * `git for-each-ref`: a property of the ref list, not of the repo store. A checkout
   * that skipped this left the panel bold on a branch it was no longer on.
   */
  it('reloads the panel for a checkout, because HEAD is part of the ref list', () =>
  {
    const { handlers, ran } = spy();
    applyInvalidation(CHECKOUT, handlers);
    expect(ran).toContain('objects');
  });

  it('preserves handler order, so the cheap visible reads go first', () =>
  {
    const { handlers, ran } = spy();
    applyInvalidation(['worktree'], handlers);
    expect(ran).toEqual(['repo', 'diff', 'tree']);
  });
});

describe('needsLogReload', () =>
{
  const all: LogScope = { branchScope: 'all', reflog: false };
  const current: LogScope = { branchScope: 'current', reflog: false };
  const filtered: LogScope = { branchScope: 'filtered', reflog: false };

  /**
   * The whole point of the change. Under the default scope the query is
   * `--branches --tags --remotes`, so a checkout returns exactly the same commits: the
   * HEAD ring and the artificial rows move reactively off the repo store, and re-running
   * the query would be a full re-stream for an identical result.
   */
  it('does not reload the grid for a checkout under the default scope', () =>
  {
    expect(needsLogReload(CHECKOUT, all)).toBe(false);
    expect(needsLogReload(CHECKOUT, filtered)).toBe(false);
  });

  it('does reload when the query is scoped to HEAD', () =>
  {
    expect(needsLogReload(CHECKOUT, current)).toBe(true);
  });

  it('does reload when the reflog is being walked, at any scope', () =>
  {
    expect(needsLogReload(CHECKOUT, { branchScope: 'all', reflog: true })).toBe(true);
  });

  /**
   * At every scope, including `current`: a row's ref badges are part of what `git log`
   * returns (`CommitRow.refs`), so a branch created or deleted anywhere in the walk
   * changes the rows even when the set of commits does not.
   */
  it('always reloads when refs moved', () =>
  {
    for (const scope of [all, current, filtered])
    {
      expect(needsLogReload(REFS, scope)).toBe(true);
    }
  });

  it('always reloads when the commit set moved', () =>
  {
    for (const scope of [all, current, filtered])
    {
      expect(needsLogReload(HISTORY_MOVE, scope)).toBe(true);
    }
  });

  it('never reloads for a read, or for work that only touched files', () =>
  {
    expect(needsLogReload(READS, all)).toBe(false);
    expect(needsLogReload(STAGING, all)).toBe(false);
    expect(needsLogReload(['worktree'], all)).toBe(false);
    expect(needsLogReload(['stashes'], all)).toBe(false);
  });
});

describe('isEveryFacet', () =>
{
  it('is true for ALL_FACETS itself', () =>
  {
    expect(isEveryFacet(ALL_FACETS)).toBe(true);
  });

  it('is true for the same facets in a different order, from a different array', () =>
  {
    // `event:repoChanged` arrives over IPC, which clones the array, this must not rely
    // on the sender having sent the literal `ALL_FACETS` constant.
    expect(isEveryFacet([...ALL_FACETS].reverse())).toBe(true);
  });

  it('is false for anything short of every facet, including HISTORY_MOVE', () =>
  {
    expect(isEveryFacet(HISTORY_MOVE)).toBe(false);
    expect(isEveryFacet(CHECKOUT)).toBe(false);
    expect(isEveryFacet(READS)).toBe(false);
  });
});

describe('headMoved', () =>
{
  /**
   * `commit`, `revert`, `cherry-pick`, `merge`, `rebase` and `reset` all declare
   * `HISTORY_MOVE`, and the grid follows HEAD to the commit they made.
   */
  it('is true for HISTORY_MOVE', () =>
  {
    expect(headMoved(HISTORY_MOVE)).toBe(true);
  });

  /**
   * And for a checkout, which is a reversal: this asked for `'commits'` too, so a
   * checkout was excluded on the grounds that it lands on a commit already drawn. The row
   * being there was never the question. The selection stayed on whatever was being looked
   * at before, on a branch that may be a thousand rows from the one just switched to, and
   * the grid looked like it had not noticed.
   */
  it('is true for a checkout, which moves HEAD without making a commit', () =>
  {
    expect(headMoved(CHECKOUT)).toBe(true);
  });

  it('is false for work that never touched HEAD', () =>
  {
    expect(headMoved(READS)).toBe(false);
    expect(headMoved(STAGING)).toBe(false);
    expect(headMoved(REFS)).toBe(false);
  });

  /**
   * `ALL_FACETS` contains `'head'` too: read literally it would fire on every F5 and
   * every `.git` watcher tick, jumping the selection out from under whoever was reading
   * an old commit at the time. This is the one exclusion, and the reason the check is not
   * a set lookup.
   */
  it('is false for the conservative everything-changed set, even though it contains head', () =>
  {
    expect(headMoved(ALL_FACETS)).toBe(false);
  });
});

