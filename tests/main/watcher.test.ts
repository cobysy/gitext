/**
 * Which paths under a git directory the watcher ignores.
 *
 * The cases that matter are the git directories that are not called `.git`: a submodule's
 * lives under `.git/modules/<name>` and a linked worktree's under `.git/worktrees/<name>`,
 * and both are what `rev-parse --absolute-git-dir` hands the watcher to watch.
 */

import { describe, expect, it } from 'vitest';
import { isChurn, isChurnIn } from '@main/watcher.js';

const CLONE = '/w/proj/.git';
const SUBMODULE = '/w/proj/.git/modules/lib';
const WORKTREE = '/w/proj/.git/worktrees/feature';

describe('isChurn', () =>
{
  it('ignores objects, locks and the commit message buffer in an ordinary clone', () =>
  {
    expect(isChurn(CLONE, `${CLONE}/objects/ab/cdef`)).toBe(true);
    expect(isChurn(CLONE, `${CLONE}/lfs/objects/a`)).toBe(true);
    expect(isChurn(CLONE, `${CLONE}/index.lock`)).toBe(true);
    expect(isChurn(CLONE, `${CLONE}/refs/heads/main.lock`)).toBe(true);
    expect(isChurn(CLONE, `${CLONE}/COMMIT_EDITMSG`)).toBe(true);
  });

  it('ignores the fsmonitor daemon’s socket and its cookies', () =>
  {
    expect(isChurn(CLONE, `${CLONE}/fsmonitor--daemon.ipc`)).toBe(true);
    expect(isChurn(CLONE, `${CLONE}/fsmonitor--daemon/cookies/1`)).toBe(true);
    expect(isChurn(WORKTREE, `${WORKTREE}/fsmonitor--daemon.ipc`)).toBe(true);
  });

  it('watches the things a reload is actually for', () =>
  {
    expect(isChurn(CLONE, `${CLONE}/HEAD`)).toBe(false);
    expect(isChurn(CLONE, `${CLONE}/refs/heads/main`)).toBe(false);
    expect(isChurn(CLONE, `${CLONE}/packed-refs`)).toBe(false);
    expect(isChurn(CLONE, `${CLONE}/MERGE_HEAD`)).toBe(false);
  });

  /** The regression: a pattern anchored on a literal `.git/objects` matches none of these. */
  it('ignores the same churn in a submodule’s git directory', () =>
  {
    expect(isChurn(SUBMODULE, `${SUBMODULE}/objects/ab/cdef`)).toBe(true);
    expect(isChurn(SUBMODULE, `${SUBMODULE}/COMMIT_EDITMSG`)).toBe(true);
    expect(isChurn(SUBMODULE, `${SUBMODULE}/index.lock`)).toBe(true);
    expect(isChurn(SUBMODULE, `${SUBMODULE}/HEAD`)).toBe(false);
  });

  it('ignores the same churn in a linked worktree’s git directory', () =>
  {
    expect(isChurn(WORKTREE, `${WORKTREE}/COMMIT_EDITMSG`)).toBe(true);
    expect(isChurn(WORKTREE, `${WORKTREE}/index.lock`)).toBe(true);
    expect(isChurn(WORKTREE, `${WORKTREE}/HEAD`)).toBe(false);
  });

  /**
   * The rule is about the top level of the directory being watched, so a branch or a file
   * that happens to be called `objects` deeper in is a change like any other.
   */
  it('does not ignore a ref that happens to be named like an ignored directory', () =>
  {
    expect(isChurn(CLONE, `${CLONE}/refs/heads/objects`)).toBe(false);
    expect(isChurn(CLONE, `${CLONE}/refs/heads/lfs`)).toBe(false);
  });

  it('says nothing about the directory itself or anything outside it', () =>
  {
    expect(isChurn(CLONE, CLONE)).toBe(false);
    expect(isChurn(CLONE, '/w/other/.git/objects/ab')).toBe(false);
  });
});

/**
 * A linked worktree is watched through two directories at once: its own, and the shared
 * one it is nested inside. Every path is read against both.
 */
describe('isChurnIn', () =>
{
  const BOTH = [WORKTREE, CLONE];

  it('ignores what either directory calls churn', () =>
  {
    expect(isChurnIn(BOTH, `${CLONE}/objects/ab/cdef`)).toBe(true);
    expect(isChurnIn(BOTH, `${WORKTREE}/COMMIT_EDITMSG`)).toBe(true);
    expect(isChurnIn(BOTH, `${WORKTREE}/index.lock`)).toBe(true);
  });

  it('watches what neither does', () =>
  {
    expect(isChurnIn(BOTH, `${CLONE}/refs/heads/main`)).toBe(false);
    expect(isChurnIn(BOTH, `${CLONE}/packed-refs`)).toBe(false);
    expect(isChurnIn(BOTH, `${WORKTREE}/HEAD`)).toBe(false);
  });
});
