/**
 * Which changes a stash would actually save.
 *
 * The rule `status.files.length` cannot express: a plain `stash push` saves tracked
 * changes only, so a tree whose whole "dirtiness" is an untracked build directory has
 * nothing for it to save, and running it there buys a subprocess and no stash.
 */

import { describe, expect, it } from 'vitest';
import {
  FILE_STATUS_IGNORED,
  FILE_STATUS_MODIFIED,
  FILE_STATUS_UNCHANGED,
  FILE_STATUS_UNTRACKED,
  type FileStatus,
  type FileStatusCode
} from '@shared/types.js';
import { hasStashableChanges, isIgnored, isUntracked } from '@renderer/model/trackedChanges.js';

function file(path: string, worktree: FileStatusCode): FileStatus
{
  return {
    path,
    index: FILE_STATUS_UNCHANGED,
    worktree,
    staged: false,
    unstaged: true,
    isSubmodule: false
  };
}

const MODIFIED = file('src/app.ts', FILE_STATUS_MODIFIED);
const UNTRACKED = file('build/out.js', FILE_STATUS_UNTRACKED);
const IGNORED = file('node_modules/x', FILE_STATUS_IGNORED);

describe('trackedChanges', () =>
{
  it('reads an untracked file off either side', () =>
  {
    expect(isUntracked(UNTRACKED)).toBe(true);
    expect(isUntracked({ ...MODIFIED, index: FILE_STATUS_UNTRACKED })).toBe(true);
    expect(isUntracked(MODIFIED)).toBe(false);
    expect(isIgnored(IGNORED)).toBe(true);
  });

  it('has nothing to save on a clean tree', () =>
  {
    expect(hasStashableChanges([], false)).toBe(false);
  });

  it('saves a tracked change either way', () =>
  {
    expect(hasStashableChanges([MODIFIED], false)).toBe(true);
    expect(hasStashableChanges([MODIFIED], true)).toBe(true);
  });

  /** The case that cost a `stash push` per checkout: dirty by count, empty to a stash. */
  it('has nothing to save when the only change is untracked and `-u` is off', () =>
  {
    expect(hasStashableChanges([UNTRACKED], false)).toBe(false);
    expect(hasStashableChanges([UNTRACKED], true)).toBe(true);
  });

  /** Ignored files need `-a`, which nothing offers, so `-u` does not reach them. */
  it('never counts an ignored file', () =>
  {
    expect(hasStashableChanges([IGNORED], true)).toBe(false);
  });

  it('counts a tracked change beside untracked ones', () =>
  {
    expect(hasStashableChanges([UNTRACKED, MODIFIED, IGNORED], false)).toBe(true);
  });
});
