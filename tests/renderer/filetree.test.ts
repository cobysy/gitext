/**
 * The changed-files list's two shapes.
 *
 * What is worth pinning here is what a click cannot easily show: that a folder exists
 * exactly when something is in it, that a collapsed folder's contents are *absent*
 * rather than merely hidden (anything else and the arrow keys walk into rows nobody can
 * see), and that dense merging renames a folder's key, which is what the collapsed set
 * and the focused row are keyed by.
 */

import { describe, expect, it } from 'vitest';
import type { DiffFileEntry } from '@shared/diff.js';
import type { TreeEntry } from '@shared/tree.js';
import {
  allFolderKeys,
  buildFileRows,
  buildGroupedFileRows,
  extensionOf,
  filesInRow,
  parentKey,
  splitPath
} from '@renderer/filetree.js';

const file = (path: string): DiffFileEntry => ({
  path,
  status: 'modified',
  score: 0,
  kind: 'blob',
  mode: '100644',
  binary: false
});

const FILES = [
  file('README.md'),
  file('src/app/main.ts'),
  file('src/app/util.ts'),
  file('src/deep/one/two/leaf.ts')
];

function shape(rows: ReturnType<typeof buildFileRows>): string[]
{
  return rows.map((row) =>
  {
    let suffix: string;
    if (row.kind === 'folder')
    {
      suffix = '/';
    }
    else
    {
      suffix = '';
    }
    return `${'  '.repeat(row.depth)}${row.label}${suffix}`;
  });
}

const none = new Set<string>();

describe('the flat view', () =>
{
  it('is one row per file, in the order given, with the directory kept apart', () =>
  {
    const rows = buildFileRows(FILES, { view: 'flat', dense: false, collapsed: none });
    expect(rows.map((row) => [row.dir, row.label])).toEqual([
      ['', 'README.md'],
      ['src/app/', 'main.ts'],
      ['src/app/', 'util.ts'],
      ['src/deep/one/two/', 'leaf.ts']
    ]);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
  });
});

describe('the tree view', () =>
{
  it('folds paths into folders, folders before files', () =>
  {
    const rows = buildFileRows(FILES, { view: 'tree', dense: false, collapsed: none });
    expect(shape(rows)).toEqual([
      'src/',
      '  app/',
      '    main.ts',
      '    util.ts',
      '  deep/',
      '    one/',
      '      two/',
      '        leaf.ts',
      'README.md'
    ]);
  });

  it('merges a chain of single-child folders when dense', () =>
  {
    const rows = buildFileRows(FILES, { view: 'tree', dense: true, collapsed: none });
    expect(shape(rows)).toEqual([
      'src/',
      '  app/',
      '    main.ts',
      '    util.ts',
      '  deep/one/two/',
      '    leaf.ts',
      'README.md'
    ]);
  });

  it('does not merge a folder that also holds files', () =>
  {
    const rows = buildFileRows([file('a/keep.ts'), file('a/b/leaf.ts')], {
      view: 'tree',
      dense: true,
      collapsed: none
    });
    expect(shape(rows)).toEqual(['a/', '  b/', '    leaf.ts', '  keep.ts']);
  });

  it('counts every file beneath a folder, nested ones included', () =>
  {
    const rows = buildFileRows(FILES, { view: 'tree', dense: false, collapsed: none });
    expect(rows.find((row) => row.key === 'src/')?.count).toBe(3);
    expect(rows.find((row) => row.key === 'src/app/')?.count).toBe(2);
  });

  it('leaves out a collapsed folder\'s contents rather than hiding them', () =>
  {
    const rows = buildFileRows(FILES, {
      view: 'tree',
      dense: true,
      collapsed: new Set(['src/'])
    });
    // Everything under `src/` is gone from the list, so nothing the keyboard can reach
    // is off screen. The folder itself says it is closed.
    expect(shape(rows)).toEqual(['src/', 'README.md']);
    expect(rows[0]?.expanded).toBe(false);
  });

  it('keys a dense folder by the path it draws', () =>
  {
    // The key changes with the setting, which is why the collapsed set is per-view and
    // not something to be carried across a toggle.
    const dense = buildFileRows(FILES, { view: 'tree', dense: true, collapsed: none });
    expect(dense.map((row) => row.key)).toContain('src/deep/one/two/');
    const plain = buildFileRows(FILES, { view: 'tree', dense: false, collapsed: none });
    expect(plain.map((row) => row.key)).toContain('src/deep/');
  });

  it('is empty for no files', () =>
  {
    expect(buildFileRows([], { view: 'tree', dense: true, collapsed: none })).toEqual([]);
  });
});

describe('allFolderKeys', () =>
{
  it('names every folder, at any depth', () =>
  {
    expect(allFolderKeys(FILES, { dense: false })).toEqual([
      'src/',
      'src/app/',
      'src/deep/',
      'src/deep/one/',
      'src/deep/one/two/'
    ]);
  });

  it('names the merged folders when dense, so collapse-all closes what is drawn', () =>
  {
    expect(allFolderKeys(FILES, { dense: true })).toEqual(['src/', 'src/app/', 'src/deep/one/two/']);
  });
});

/**
 * The same folding over the other list the pane offers.
 *
 * The file tree at a revision has no statuses and no rename origins: it is paths and
 * nothing else, and it goes through this code rather than a copy of it, so that the two
 * lists cannot come to disagree about what a merged chain is called or which rows a
 * collapsed folder leaves out.
 */
describe('any entry with a path', () =>
{
  const entry = (path: string): TreeEntry => ({ path, kind: 'blob', mode: '100644' });

  const TREE = [
    entry('README.md'),
    entry('src/app/main.ts'),
    entry('src/deep/one/two/leaf.ts'),
    { path: 'externals/lib', kind: 'submodule', mode: '160000' } as TreeEntry
  ];

  it('folds into the same shape as the changed-files list', () =>
  {
    expect(shape(buildFileRows(TREE, { view: 'tree', dense: true, collapsed: none }))).toEqual([
      'externals/',
      '  lib',
      'src/',
      '  app/',
      '    main.ts',
      // Merged, because `deep` holds nothing but one folder all the way down: while
      // `src` holds two and stays a row of its own.
      '  deep/one/two/',
      '    leaf.ts',
      'README.md'
    ]);
  });

  it('carries the entry through onto the row, whatever it is', () =>
  {
    const rows = buildFileRows(TREE, { view: 'flat', dense: false, collapsed: none });
    expect(rows.find((row) => row.key === 'externals/lib')?.file?.kind).toBe('submodule');
  });

  it('leaves a collapsed folder\'s contents out of the rows, as it does for a diff', () =>
  {
    const rows = buildFileRows(TREE, {
      view: 'tree',
      dense: true,
      collapsed: new Set(['src/app/'])
    });
    expect(rows.map((row) => row.key)).not.toContain('src/app/main.ts');
  });
});

describe('splitPath and parentKey', () =>
{
  it('splits a path into its directory and its name', () =>
  {
    expect(splitPath('a/b/c.ts')).toEqual({ dir: 'a/b/', name: 'c.ts' });
    expect(splitPath('c.ts')).toEqual({ dir: '', name: 'c.ts' });
  });

  it('finds the folder a row lives in, for either kind of key', () =>
  {
    expect(parentKey('a/b/c.ts')).toBe('a/b/');
    expect(parentKey('a/b/')).toBe('a/');
    expect(parentKey('a/')).toBeNull();
    expect(parentKey('c.ts')).toBeNull();
  });
});

describe('the files a folder row stands for', () =>
{
  it('is everything under it, nested folders included', () =>
  {
    expect(filesInRow(FILES, 'src/').map((f) => f.path)).toEqual([
      'src/app/main.ts',
      'src/app/util.ts',
      'src/deep/one/two/leaf.ts'
    ]);
    expect(filesInRow(FILES, 'src/app/').map((f) => f.path)).toEqual([
      'src/app/main.ts',
      'src/app/util.ts'
    ]);
  });

  it('answers for a dense-merged folder, whose key names the whole chain', () =>
  {
    const keys = allFolderKeys(FILES, { dense: true });
    expect(keys).toContain('src/deep/one/two/');
    expect(filesInRow(FILES, 'src/deep/one/two/').map((f) => f.path)).toEqual([
      'src/deep/one/two/leaf.ts'
    ]);
  });

  it('does not take a sibling whose name merely starts the same', () =>
  {
    const files = [file('src/a.ts'), file('srclib/b.ts'), file('src.txt')];
    expect(filesInRow(files, 'src/').map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('resolves a group heading through the same grouping the rows were built with', () =>
  {
    const files = [file('a.ts'), file('b.md'), file('c.ts')];
    const groupOf = (f: DiffFileEntry): string => extensionOf(f.path);
    const rows = buildGroupedFileRows(files, { groupOf, collapsed: none });
    const heading = rows.find((row) => row.kind === 'folder' && row.label === '.ts')!;

    expect(filesInRow(files, heading.key, groupOf).map((f) => f.path)).toEqual(['a.ts', 'c.ts']);
  });

  it('answers nothing for a group heading with no grouping to resolve it', () =>
  {
    expect(filesInRow(FILES, 'group:.ts/')).toEqual([]);
  });
});
