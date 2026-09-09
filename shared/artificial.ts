/**
 * The two rows the revision grid shows that are not commits: the working tree and the
 * index, known here as artificial commits. They sit above HEAD and chain into it,
 * working tree → index → HEAD, so the graph draws one continuous line and the diff
 * pivots have something to point at. Pure, so which rows exist for a given `git status` is an ordinary unit test.
 */

import {
  FILE_STATUS_ADDED,
  FILE_STATUS_CONFLICTED,
  FILE_STATUS_COPIED,
  FILE_STATUS_DELETED,
  FILE_STATUS_UNTRACKED,
  type ArtificialRowKind,
  type CommitRow,
  type FileStatus,
  type WorkingTreeStatus
} from './types.js';

/**
 * Sentinel SHAs. Deliberately the same forty-character shape as a real SHA so nothing
 * downstream needs a separate code path to carry one around; they can never collide
 * with a real object, since no content hashes to all-ones. Nothing may hand these to
 * git: `git show 1111…` fails, so every call site taking a selected SHA asks `isArtificialSha` first.
 */
export const WORKING_TREE_SHA = '1111111111111111111111111111111111111111';
export const INDEX_SHA = '2222222222222222222222222222222222222222';

export const ROW_KIND_WORKING_TREE = 'workingTree';
export const ROW_KIND_INDEX = 'index';

/** What each artificial row is called on screen. */
const LABELS: Record<ArtificialRowKind, string> = {
  workingTree: 'Working directory',
  index: 'Commit index'
};

/** Which artificial row `sha` is, or null for a real commit. */
export function artificialKind(sha: string): ArtificialRowKind | null
{
  if (sha === WORKING_TREE_SHA)
  {
    return ROW_KIND_WORKING_TREE;
  }
  if (sha === INDEX_SHA)
  {
    return ROW_KIND_INDEX;
  }
  return null;
}

export function isArtificialSha(sha: string): boolean
{
  return artificialKind(sha) !== null;
}

/** Files an artificial row is about: staged ones for the index, the rest for the tree. */
export function filesFor(kind: ArtificialRowKind, files: readonly FileStatus[]): FileStatus[]
{
  return files.filter((f) =>
  {
    if (kind === ROW_KIND_INDEX)
    {
      return f.staged;
    }
    else
    {
      return f.unstaged;
    }
  });
}

/**
 * What the grid puts in an artificial row's message column, in place of a subject.
 * Counted, not listed: the row is one line tall, and the file list pane is where names
 * belong. No separate submodule-dirty count: `git status` reports one as a modified path like any other.
 */
export interface ArtificialChangeCount {
  modified: number;
  added: number;
  deleted: number;
  conflicted: number;
  total: number;
}

export function countChanges(files: readonly FileStatus[]): ArtificialChangeCount
{
  const count: ArtificialChangeCount = {
    modified: 0,
    added: 0,
    deleted: 0,
    conflicted: 0,
    total: files.length
  };

  for (const file of files)
  {
    // The index side describes a staged change, the worktree side an unstaged one; whichever is set is the one this row is reporting.
    let code;
    if (file.staged)
    {
      code = file.index;
    }
    else
    {
      code = file.worktree;
    }
    switch (code)
    {
      case FILE_STATUS_ADDED:
      case FILE_STATUS_UNTRACKED:
      case FILE_STATUS_COPIED:
        count.added++;
        break;
      case FILE_STATUS_DELETED:
        count.deleted++;
        break;
      case FILE_STATUS_CONFLICTED:
        count.conflicted++;
        break;
      default:
        count.modified++;
    }
  }

  return count;
}

/** "3 modified, 1 new": empty when there is nothing to say. */
export function describeChanges(count: ArtificialChangeCount): string
{
  const parts: string[] = [];
  if (count.modified)
  {
    parts.push(`${count.modified} modified`);
  }
  if (count.added)
  {
    parts.push(`${count.added} new`);
  }
  if (count.deleted)
  {
    parts.push(`${count.deleted} deleted`);
  }
  if (count.conflicted)
  {
    parts.push(`${count.conflicted} conflicted`);
  }
  return parts.join(', ');
}

/**
 * Build the artificial rows for a status, newest first, ready to prepend to the log. A
 * row exists only when it has something in it: "nothing staged" is better said by its
 * absence than a row reading "0 changes". The parent chain skips whichever row is
 * missing, so the working tree hangs directly off HEAD when nothing is staged; in an unborn repository the chain simply ends.
 */
export function buildArtificialRows(
  status: WorkingTreeStatus | null,
  headSha: string | null
): CommitRow[]
{
  if (!status)
  {
    return [];
  }

  const hasStaged = status.files.some((f) => f.staged);
  const hasUnstaged = status.files.some((f) => f.unstaged);

  const rows: CommitRow[] = [];
  if (hasUnstaged)
  {
    let workingTreeParent: string | null;
    if (hasStaged)
    {
      workingTreeParent = INDEX_SHA;
    }
    else
    {
      workingTreeParent = headSha;
    }
    rows.push(makeRow(ROW_KIND_WORKING_TREE, workingTreeParent));
  }
  if (hasStaged)
  {
    rows.push(makeRow(ROW_KIND_INDEX, headSha));
  }
  return rows;
}

function makeRow(kind: ArtificialRowKind, parent: string | null): CommitRow
{
  let sha: string;
  if (kind === ROW_KIND_INDEX)
  {
    sha = INDEX_SHA;
  }
  else
  {
    sha = WORKING_TREE_SHA;
  }
  let parents: string[];
  if (parent)
  {
    parents = [parent];
  }
  else
  {
    parents = [];
  }
  return {
    sha,
    parents,
    // Left blank rather than filled with `user.name`: these rows aren't authored by anyone yet, and the grid renders the empty author and zero date as an em-dash.
    authorName: '',
    authorEmail: '',
    authorDate: 0,
    committerName: '',
    committerEmail: '',
    committerDate: 0,
    subject: LABELS[kind],
    body: '',
    refs: [],
    note: ''
  };
}
