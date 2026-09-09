/**
 * What a row in the changed-files/tree pane says about itself.
 *
 * `fileRowDescription.ts` is pure and its own header says why: the status letter, the
 * submodule/symlink/binary mark, and the hover text are worth reaching by a unit test
 * rather than only by opening a diff and looking at a tooltip.
 */

import { describe, expect, it } from 'vitest';
import type { DiffFileEntry } from '@shared/diff.js';
import type { TreeEntry } from '@shared/tree.js';
import { OBJECT_KIND_BLOB, OBJECT_KIND_SUBMODULE } from '@shared/types/objects.js';
import { ROW_KIND_FILE, ROW_KIND_FOLDER, type FileRow } from '@renderer/filetree.js';
import {
  MARK_LABEL,
  MARK_TITLE,
  STATUS_LETTER,
  STATUS_TITLE,
  linesOf,
  markOf,
  rowLines,
  rowMark,
  rowStatus,
  rowTitle,
  statusOf,
  type PaneEntry
} from '@renderer/model/fileRowDescription.js';

/** A changed-files entry, defaulted to an ordinary modified blob. */
function diffEntry(overrides: Partial<DiffFileEntry> = {}): DiffFileEntry
{
  return {
    path: 'src/app.ts',
    status: 'modified',
    score: 0,
    kind: OBJECT_KIND_BLOB,
    mode: '100644',
    binary: false,
    ...overrides
  };
}

/** A file-tree entry, defaulted to an ordinary blob. */
function treeEntry(overrides: Partial<TreeEntry> = {}): TreeEntry
{
  return {
    path: 'src/app.ts',
    kind: OBJECT_KIND_BLOB,
    mode: '100644',
    ...overrides
  };
}

function fileRow(file: PaneEntry): FileRow<PaneEntry>
{
  return {
    kind: ROW_KIND_FILE,
    key: file.path,
    label: file.path,
    dir: '',
    depth: 0,
    file,
    count: 0,
    expanded: false
  };
}

function folderRow(key: string, count: number): FileRow<PaneEntry>
{
  return { kind: ROW_KIND_FOLDER, key, label: key, dir: '', depth: 0, count, expanded: true };
}

describe('statusOf', () =>
{
  it('reads a changed entry\'s own status', () =>
  {
    expect(statusOf(diffEntry({ status: 'added' }), new Map())).toBe('added');
  });

  it('looks a tree entry up in what the selection changed', () =>
  {
    const changed = new Map([['src/app.ts', 'modified' as const]]);
    expect(statusOf(treeEntry(), changed)).toBe('modified');
  });

  it('is null for a tree entry the selection left alone', () =>
  {
    expect(statusOf(treeEntry(), new Map())).toBeNull();
  });
});

describe('linesOf', () =>
{
  it('reads a changed entry\'s own counts', () =>
  {
    const entry = diffEntry({ lines: { added: 12, deleted: 3 } });
    expect(linesOf(entry, new Map())).toEqual({ added: 12, deleted: 3 });
  });

  it('looks a tree entry up in what the selection changed', () =>
  {
    const changed = new Map([['src/app.ts', { added: 2, deleted: 1 }]]);
    expect(linesOf(treeEntry(), changed)).toEqual({ added: 2, deleted: 1 });
  });

  it('is null where git counted nothing, which is not the same as counting zero', () =>
  {
    expect(linesOf(diffEntry({ binary: true }), new Map())).toBeNull();
    expect(linesOf(treeEntry(), new Map())).toBeNull();
  });
});

describe('markOf', () =>
{
  it('marks a submodule from its kind', () =>
  {
    expect(markOf(diffEntry({ kind: OBJECT_KIND_SUBMODULE }))).toBe('submodule');
    expect(markOf(treeEntry({ kind: OBJECT_KIND_SUBMODULE }))).toBe('submodule');
  });

  it('marks a symlink from its mode', () =>
  {
    expect(markOf(diffEntry({ mode: '120000' }))).toBe('symlink');
  });

  it('marks a binary changed file', () =>
  {
    expect(markOf(diffEntry({ binary: true }))).toBe('binary');
  });

  it('a tree entry is never binary: nothing tells a listing that', () =>
  {
    expect(markOf(treeEntry())).toBeNull();
  });

  it('is null for an ordinary file', () =>
  {
    expect(markOf(diffEntry())).toBeNull();
  });
});

describe('rowStatus / rowMark / rowLines', () =>
{
  it('reads through to the row\'s file', () =>
  {
    const row = fileRow(diffEntry({ status: 'deleted', lines: { added: 0, deleted: 7 } }));
    expect(rowStatus(row, new Map())).toBe('deleted');
    expect(rowLines(row, new Map())).toEqual({ added: 0, deleted: 7 });
  });

  it('is null for a folder row', () =>
  {
    const row = folderRow('src/', 3);
    expect(rowStatus(row, new Map())).toBeNull();
    expect(rowMark(row)).toBeNull();
    expect(rowLines(row, new Map())).toBeNull();
  });
});

describe('rowTitle', () =>
{
  it('names a folder by its file count, singular', () =>
  {
    expect(rowTitle(folderRow('src/', 1), new Map())).toBe('src/: 1 file');
  });

  it('names a folder by its file count, plural', () =>
  {
    expect(rowTitle(folderRow('src/', 4), new Map())).toBe('src/: 4 files');
  });

  it('an unchanged tree row is just its path', () =>
  {
    expect(rowTitle(fileRow(treeEntry()), new Map())).toBe('src/app.ts');
  });

  it('leads with the status for a changed file', () =>
  {
    const row = fileRow(diffEntry({ status: 'added' }));
    expect(rowTitle(row, new Map())).toBe('Added · src/app.ts');
  });

  it('names the origin for a rename, rather than "Renamed: <new path>"', () =>
  {
    const row = fileRow(diffEntry({ status: 'renamed', origPath: 'src/old.ts' }));
    expect(rowTitle(row, new Map())).toBe('Renamed from src/old.ts');
  });

  it('leads with the mark ahead of the status', () =>
  {
    const row = fileRow(diffEntry({ status: 'modified', kind: OBJECT_KIND_SUBMODULE }));
    expect(rowTitle(row, new Map())).toBe('Submodule · Modified · src/app.ts');
  });
});

describe('the letter/label/title tables are exhaustive over their unions', () =>
{
  it('every FileStatusCode has a letter and a title', () =>
  {
    const codes = Object.keys(STATUS_LETTER) as (keyof typeof STATUS_LETTER)[];
    for (const code of codes)
    {
      expect(STATUS_TITLE[code]).toBeTruthy();
    }
  });

  it('every mark has a short label and a full title', () =>
  {
    const marks = Object.keys(MARK_LABEL) as (keyof typeof MARK_LABEL)[];
    for (const mark of marks)
    {
      expect(MARK_TITLE[mark]).toBeTruthy();
    }
  });
});
