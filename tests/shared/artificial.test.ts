/**
 * The working-tree and index rows.
 *
 * Worth unit-testing rather than staging files and looking at the grid, which rows
 * exist, and what each one's parent is, depends on four combinations of staged and
 * unstaged that are tedious to reach by hand, and the parent chain is what the graph
 * draws, so getting it wrong shows up as a broken line rather than as an error.
 */

import { describe, expect, it } from 'vitest';
import {
  INDEX_SHA,
  WORKING_TREE_SHA,
  artificialKind,
  buildArtificialRows,
  countChanges,
  describeChanges,
  filesFor,
  isArtificialSha
} from '@shared/artificial.js';
import type { FileStatus, FileStatusCode, WorkingTreeStatus } from '@shared/types.js';

const HEAD = 'a'.repeat(40);

/** One `git status` entry. `index`/`worktree` drive `staged`/`unstaged`, as parse.ts does. */
function file(path: string, index: FileStatusCode, worktree: FileStatusCode): FileStatus
{
  return {
    path,
    index,
    worktree,
    staged: index !== 'unknown',
    unstaged: worktree !== 'unknown',
    isSubmodule: false
  };
}

function status(...files: FileStatus[]): WorkingTreeStatus
{
  return { branch: 'main', upstream: null, ahead: 0, behind: 0, files };
}

const staged = file('staged.txt', 'modified', 'unknown');
const unstaged = file('dirty.txt', 'unknown', 'modified');
const untracked = file('new.txt', 'unknown', 'untracked');

describe('sentinel SHAs', () =>
{
  it('are recognised, and real SHAs are not', () =>
  {
    expect(artificialKind(WORKING_TREE_SHA)).toBe('workingTree');
    expect(artificialKind(INDEX_SHA)).toBe('index');
    expect(artificialKind(HEAD)).toBeNull();
    expect(isArtificialSha(HEAD)).toBe(false);
  });

  it('are the same forty-character shape as a real SHA', () =>
  {
    // Downstream code carries them through `rowOf`, selection and the details pane
    // without a separate code path, which only holds while they look like SHAs.
    expect(WORKING_TREE_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(INDEX_SHA).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('which rows exist', () =>
{
  it('shows neither on a clean tree', () =>
  {
    expect(buildArtificialRows(status(), HEAD)).toEqual([]);
  });

  it('shows neither when there is no status at all', () =>
  {
    expect(buildArtificialRows(null, HEAD)).toEqual([]);
  });

  it('shows only the working tree when nothing is staged', () =>
  {
    const rows = buildArtificialRows(status(unstaged), HEAD);
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA]);
    // With no index row in between, it hangs directly off HEAD so the line is unbroken.
    expect(rows[0]!.parents).toEqual([HEAD]);
  });

  it('shows only the index when everything is staged', () =>
  {
    const rows = buildArtificialRows(status(staged), HEAD);
    expect(rows.map((r) => r.sha)).toEqual([INDEX_SHA]);
    expect(rows[0]!.parents).toEqual([HEAD]);
  });

  it('chains working tree → index → HEAD when there is both', () =>
  {
    const rows = buildArtificialRows(status(staged, unstaged), HEAD);
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA, INDEX_SHA]);
    expect(rows[0]!.parents).toEqual([INDEX_SHA]);
    expect(rows[1]!.parents).toEqual([HEAD]);
  });

  it('counts a partially-staged file as both', () =>
  {
    // `git add` then edit again: staged on the index side, dirty on the worktree side.
    const rows = buildArtificialRows(status(file('both.txt', 'modified', 'modified')), HEAD);
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA, INDEX_SHA]);
  });

  it('puts untracked files on the working tree row only', () =>
  {
    const rows = buildArtificialRows(status(untracked), HEAD);
    expect(rows.map((r) => r.sha)).toEqual([WORKING_TREE_SHA]);
  });

  it('leaves the chain rootless in an unborn repository', () =>
  {
    // No HEAD to parent onto: an unborn branch's working tree really is a root.
    const rows = buildArtificialRows(status(staged, unstaged), null);
    expect(rows[0]!.parents).toEqual([INDEX_SHA]);
    expect(rows[1]!.parents).toEqual([]);
  });

  it('leaves author and date empty rather than inventing them', () =>
  {
    const [row] = buildArtificialRows(status(unstaged), HEAD);
    expect(row!.authorName).toBe('');
    expect(row!.authorDate).toBe(0);
    expect(row!.refs).toEqual([]);
  });
});

describe('splitting files between the two rows', () =>
{
  const files = [staged, unstaged, untracked, file('both.txt', 'added', 'modified')];

  it('gives the index its staged files', () =>
  {
    expect(filesFor('index', files).map((f) => f.path)).toEqual(['staged.txt', 'both.txt']);
  });

  it('gives the working tree everything unstaged, untracked included', () =>
  {
    expect(filesFor('workingTree', files).map((f) => f.path)).toEqual([
      'dirty.txt',
      'new.txt',
      'both.txt'
    ]);
  });
});

describe('change counts', () =>
{
  it('reads the index side for staged files and the worktree side otherwise', () =>
  {
    expect(countChanges([staged])).toMatchObject({ modified: 1, added: 0, total: 1 });
    expect(countChanges([untracked])).toMatchObject({ added: 1, modified: 0, total: 1 });
  });

  it('groups renames and typechanges as modifications, copies as new', () =>
  {
    const files = [
      file('r.txt', 'renamed', 'unknown'),
      file('t.txt', 'typechange', 'unknown'),
      file('c.txt', 'copied', 'unknown')
    ];
    expect(countChanges(files)).toMatchObject({ modified: 2, added: 1 });
  });

  it('counts conflicts separately: they are not just modifications', () =>
  {
    const conflicted: FileStatus = {
      path: 'x.txt',
      index: 'conflicted',
      worktree: 'conflicted',
      staged: false,
      unstaged: true,
      isSubmodule: false
    };
    expect(countChanges([conflicted])).toMatchObject({ conflicted: 1, modified: 0 });
  });

  it('describes only the non-zero categories', () =>
  {
    expect(describeChanges(countChanges([staged, untracked]))).toBe('1 modified, 1 new');
    expect(describeChanges(countChanges([]))).toBe('');
  });
});
