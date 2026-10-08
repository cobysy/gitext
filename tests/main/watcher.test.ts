/**
 * Which paths under a git directory the watcher ignores.
 *
 * The cases that matter are the git directories that are not called `.git`: a submodule's
 * lives under `.git/modules/<name>` and a linked worktree's under `.git/worktrees/<name>`,
 * and both are what `rev-parse --absolute-git-dir` hands the watcher to watch.
 */

import { describe, expect, it } from 'vitest';
import { isChurn as isChurnWith, isChurnIn as isChurnInWith } from '@main/watchIgnore.js';

const CLONE = '/w/proj/.git';
const SUBMODULE = '/w/proj/.git/modules/lib';
const WORKTREE = '/w/proj/.git/worktrees/feature';
/** A submodule named after its path, so its name is two segments. */
const DEEP_SUBMODULE = '/w/proj/.git/modules/vendor/lfs';
/** A submodule of that submodule. */
const NESTED_SUBMODULE = `${SUBMODULE}/modules/inner`;

const GIT_DIRS = new Set([CLONE, SUBMODULE, WORKTREE, DEEP_SUBMODULE, NESTED_SUBMODULE]);
const isGitDir = (path: string): boolean => GIT_DIRS.has(path);

function isChurn(gitDir: string, path: string): boolean
{
  return isChurnWith(gitDir, path, isGitDir);
}

function isChurnIn(gitDirs: readonly string[], path: string): boolean
{
  return isChurnInWith(gitDirs, path, isGitDir);
}

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
   * Watching the shared directory watches every linked worktree's own directory nested in
   * it, and `fs.watch` on the daemon's socket there fails just as it does at the top.
   */
  it('ignores a linked worktree’s churn seen from the shared directory', () =>
  {
    expect(isChurn(CLONE, `${WORKTREE}/fsmonitor--daemon.ipc`)).toBe(true);
    expect(isChurn(CLONE, `${WORKTREE}/fsmonitor--daemon/cookies/1`)).toBe(true);
    expect(isChurn(CLONE, `${WORKTREE}/COMMIT_EDITMSG`)).toBe(true);
    expect(isChurn(CLONE, `${WORKTREE}/HEAD`)).toBe(false);
    expect(isChurn(CLONE, `${WORKTREE}/MERGE_HEAD`)).toBe(false);
  });

  /** Opening the superproject watches every submodule's git directory along with its own. */
  it('ignores a submodule’s churn seen from the superproject', () =>
  {
    expect(isChurn(CLONE, `${SUBMODULE}/objects/ab`)).toBe(true);
    expect(isChurn(CLONE, `${SUBMODULE}/fsmonitor--daemon.ipc`)).toBe(true);
    expect(isChurn(CLONE, `${SUBMODULE}/COMMIT_EDITMSG`)).toBe(true);
    expect(isChurn(CLONE, `${SUBMODULE}/HEAD`)).toBe(false);
    expect(isChurn(CLONE, `${SUBMODULE}/refs/heads/objects`)).toBe(false);
  });

  it('finds a submodule’s git directory however many segments its name takes', () =>
  {
    expect(isChurn(CLONE, `${DEEP_SUBMODULE}/objects/ab`)).toBe(true);
    expect(isChurn(CLONE, `${DEEP_SUBMODULE}/fsmonitor--daemon.ipc`)).toBe(true);
    expect(isChurn(CLONE, `${DEEP_SUBMODULE}/HEAD`)).toBe(false);
    expect(isChurn(CLONE, DEEP_SUBMODULE)).toBe(false);
  });

  it('follows a submodule’s own submodules down', () =>
  {
    expect(isChurn(CLONE, `${NESTED_SUBMODULE}/objects/ab`)).toBe(true);
    expect(isChurn(CLONE, `${NESTED_SUBMODULE}/HEAD`)).toBe(false);
  });

  /**
   * A name segment is only a name: the git directory it belongs to decides what is churn,
   * so a worktree called `objects` is watched like any other.
   */
  it('does not ignore a nested git directory that happens to be named like an ignored one', () =>
  {
    const objects = `${CLONE}/worktrees/objects`;
    const withObjects = (path: string): boolean => path === objects || isGitDir(path);
    expect(isChurnWith(CLONE, `${objects}/HEAD`, withObjects)).toBe(false);
    expect(isChurnWith(CLONE, `${objects}/objects/ab`, withObjects)).toBe(true);
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
