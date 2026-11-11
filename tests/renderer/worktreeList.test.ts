/**
 * The worktree manager's list: where the worktrees live, what each row says, and which
 * of a pick can be removed.
 */

import { describe, expect, it } from 'vitest';
import { commonDir, isRemovable, treeEntries, worktreeStates } from '@renderer/model/worktreeList.js';
import type { WorktreeEntry } from '@shared/types.js';

function worktree(path: string, extra: Partial<WorktreeEntry> = {}): WorktreeEntry
{
  return {
    path,
    head: '0123456789abcdef0123456789abcdef01234567',
    branch: 'feature',
    isBare: false,
    isDetached: false,
    isLocked: false,
    lockReason: '',
    prunable: false,
    isMain: false,
    ...extra
  };
}

describe('commonDir', () =>
{
  it('is the deepest directory every path is inside', () =>
  {
    expect(commonDir(['/p/repo', '/p/repo-wt/a', '/p/repo-wt/b'])).toBe('/p/');
  });

  // A worktree inside the repository is still a path below the directory, not the directory.
  it('never swallows a path whole', () =>
  {
    expect(commonDir(['/p/repo', '/p/repo/wt/a'])).toBe('/p/');
    expect(commonDir(['/p/repo'])).toBe('/p/');
  });
});

describe('treeEntries', () =>
{
  it('folds paths relative to the common directory, so a directory of worktrees is one folder', () =>
  {
    const { base, entries } = treeEntries([worktree('/p/repo'), worktree('/p/wt/a'), worktree('/p/wt/b')]);
    expect(base).toBe('/p/');
    expect(entries.map((entry) => entry.path)).toEqual(['repo', 'wt/a', 'wt/b']);
  });
});

describe('isRemovable', () =>
{
  it('is never the repository itself, nor the worktree this window has open', () =>
  {
    expect(isRemovable(worktree('/p/repo', { isMain: true }), '/p/other')).toBe(false);
    expect(isRemovable(worktree('/p/wt/a'), '/p/wt/a')).toBe(false);
    expect(isRemovable(worktree('/p/wt/a'), '/p/repo')).toBe(true);
  });
});

describe('worktreeStates', () =>
{
  it('says both "the repository" and "you are here" when both are true', () =>
  {
    expect(worktreeStates(worktree('/p/repo', { isMain: true }), '/p/repo')).toEqual([
      'the repository',
      'you are here'
    ]);
  });

  it('names what is checked out when it is not a branch', () =>
  {
    expect(worktreeStates(worktree('/p/wt/a', { branch: null, isDetached: true, isLocked: true }), null)).toEqual([
      'detached',
      'locked'
    ]);
  });
});
