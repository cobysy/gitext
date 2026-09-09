/**
 * Status letters, marks (submodule/symlink/binary), and hover text for file rows.
 * Pure module: no store or DOM dependency.
 */

import type { DiffFileEntry, LineCounts } from '@shared/diff.js';
import { isSymlinkMode } from '@shared/mode.js';
import type { TreeEntry } from '@shared/tree.js';
import type { FileStatusCode } from '@shared/types.js';
import { ROW_KIND_FOLDER, type FileRow } from '@renderer/filetree.js';

export type PaneEntry = DiffFileEntry | TreeEntry;

/** The single letter git itself uses, so the list reads like `--name-status` output. */
export const STATUS_LETTER: Record<DiffFileEntry['status'], string> = {
  // Never drawn: a tree entry carries no status at all, so its rows take the branch below
  // rather than this table. Here because the table is exhaustive over the type.
  unchanged: ' ',
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  conflicted: 'U',
  untracked: '?',
  ignored: '!',
  unknown: ' '
};

export const STATUS_TITLE: Record<DiffFileEntry['status'], string> = {
  unchanged: 'Unchanged',
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechange: 'Type changed',
  conflicted: 'Conflicted',
  untracked: 'Untracked',
  ignored: 'Ignored',
  unknown: 'Changed'
};

/**
 * Marks for rows that are not ordinary files.
 * Only the changed list answers binary status; tree lists only report it by examining mode.
 */
export type FileMark = 'submodule' | 'symlink' | 'binary';

export const MARK_SUBMODULE = 'submodule';
const MARK_SYMLINK = 'symlink';
const MARK_BINARY = 'binary';

export const MARK_LABEL: Record<FileMark, string> = {
  submodule: 'sub',
  symlink: 'link',
  binary: 'bin'
};

// Middot joins facts as a list, not a sentence.
const SEPARATOR = ' · ';

export const MARK_TITLE: Record<FileMark, string> = {
  submodule: 'Submodule',
  symlink: 'Symbolic link',
  binary: 'Binary file'
};

/**
 * Status for a changed entry, or look it up in the commit's changed set for a tree entry.
 */
export function statusOf(
  entry: PaneEntry,
  changedStatus: ReadonlyMap<string, FileStatusCode>
): FileStatusCode | null
{
  if ('status' in entry)
  {
    return entry.status;
  }
  return changedStatus.get(entry.path) ?? null;
}

/**
 * What the change did to a file, in lines: the entry's own counts, or the changed list's
 * for a tree entry, which knows what a file *is* and not what happened to it.
 *
 * Null where git counted nothing: a binary file, or an untracked one.
 */
export function linesOf(
  entry: PaneEntry,
  changedLines: ReadonlyMap<string, LineCounts>
): LineCounts | null
{
  if ('lines' in entry && entry.lines)
  {
    return entry.lines;
  }
  return changedLines.get(entry.path) ?? null;
}

export function markOf(entry: PaneEntry): FileMark | null
{
  if ('kind' in entry && entry.kind === MARK_SUBMODULE)
  {
    return MARK_SUBMODULE;
  }
  if (isSymlinkMode(entry.mode))
  {
    return MARK_SYMLINK;
  }
  if ('binary' in entry && entry.binary)
  {
    return MARK_BINARY;
  }
  return null;
}

export function rowStatus(
  row: FileRow<PaneEntry>,
  changedStatus: ReadonlyMap<string, FileStatusCode>
): FileStatusCode | null
{
  if (row.file)
  {
    return statusOf(row.file, changedStatus);
  }
  else
  {
    return null;
  }
}

export function rowLines(
  row: FileRow<PaneEntry>,
  changedLines: ReadonlyMap<string, LineCounts>
): LineCounts | null
{
  if (row.file)
  {
    return linesOf(row.file, changedLines);
  }
  else
  {
    return null;
  }
}

export function rowMark(row: FileRow<PaneEntry>): FileMark | null
{
  if (row.file)
  {
    return markOf(row.file);
  }
  else
  {
    return null;
  }
}

export function rowTitle(
  row: FileRow<PaneEntry>,
  changedStatus: ReadonlyMap<string, FileStatusCode>
): string
{
  if (row.kind === ROW_KIND_FOLDER)
  {
    let noun: string;
    if (row.count === 1)
    {
      noun = 'file';
    }
    else
    {
      noun = 'files';
    }
    return `${row.key}: ${row.count} ${noun}`;
  }
  const file = row.file!;
  const mark = markOf(file);
  let what;
  if (mark)
  {
    what = `${MARK_TITLE[mark]}${SEPARATOR}`;
  }
  else
  {
    what = '';
  }
  const status = statusOf(file, changedStatus);
  if (status === null)
  {
    return `${what}${file.path}`;
  }
  if ('origPath' in file && file.origPath)
  {
    return `${what}${STATUS_TITLE[status]} from ${file.origPath}`;
  }
  else
  {
    return `${what}${STATUS_TITLE[status]}${SEPARATOR}${file.path}`;
  }
}
