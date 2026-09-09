/**
 * A list of paths as a flat list or as a tree of folders. Which is better depends on
 * the diff: twelve files across three directories read best as a list, eighty files
 * from a mass rename read as noise until folded up. A view over the same entries, not a different query.
 *
 * Generic over the entry, since the pane has two lists over the same shape: what a
 * commit changed (`DiffFileEntry`) and what it *contains* (`TreeEntry`). A copy of this
 * for the second would give the two lists different answers about a merged chain or a collapsed folder.
 *
 * Pure, importing nothing that touches `window`: the awkward parts (a folder existing
 * only because something's in it, merged single-child chains, arrow keys skipping a
 * collapsed folder's hidden rows) are all unit tests here.
 *
 * A row's identity is its path, never its index, same as the grid's SHA-keyed
 * selection: the list rebuilds on every refresh, and anything keyed by position slides onto a different file.
 */

import type { DiffFileEntry } from '@shared/diff.js';

/** The least an entry has to be to be foldable: something with a path. */
export interface PathEntry {
  path: string;
}

export const ROW_KIND_FILE = 'file' as const;
export const ROW_KIND_FOLDER = 'folder' as const;

export interface FileRow<T extends PathEntry = DiffFileEntry> {
  kind: typeof ROW_KIND_FILE | typeof ROW_KIND_FOLDER;
  /** The file's path, or the folder's path with a trailing slash. Stable, so it keys
   *  the collapsed set and the focus across a refresh. */
  key: string;
  /** What the row draws: a filename, or a folder name, several, when merged. */
  label: string;
  /** The directory part, drawn dim ahead of the name. Empty in the tree view, where
   *  the indentation already says it. */
  dir: string;
  depth: number;
  /** Set on file rows only. */
  file?: T;
  /** Folders: how many files are inside, nested ones included. */
  count: number;
  /** Folders: whether this row's children follow it. */
  expanded: boolean;
}

export const VIEW_FLAT = 'flat' as const;
export const VIEW_TREE = 'tree' as const;

export interface FileRowOptions {
  view: typeof VIEW_FLAT | typeof VIEW_TREE;
  /** Merge a folder holding nothing but one other folder into a single row (`renderer/components/diff` not four rows of one child each). */
  dense: boolean;
  /** Folder keys whose children are hidden. */
  collapsed: ReadonlySet<string>;
}

interface Folder<T extends PathEntry> {
  children: Map<string, Folder<T>>;
  files: T[];
  count: number;
}

/** Split a path into its directory prefix (with the trailing slash) and its name. */
export function splitPath(path: string): { dir: string; name: string }
{
  const cut = path.lastIndexOf('/');
  if (cut === -1)
  {
    return { dir: '', name: path };
  }
  else
  {
    return { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
  }
}

/** The folder a row lives in, or null at the top level. */
export function parentKey(key: string): string | null
{
  // A folder key ends in a slash, which is its own segment boundary and not its parent's.
  let path;
  if (key.endsWith('/'))
  {
    path = key.slice(0, -1);
  }
  else
  {
    path = key;
  }
  const cut = path.lastIndexOf('/');
  if (cut === -1)
  {
    return null;
  }
  else
  {
    return path.slice(0, cut + 1);
  }
}

function insert<T extends PathEntry>(root: Folder<T>, file: T): void
{
  const segments = file.path.split('/');
  const name = segments.pop();
  if (name === undefined)
  {
    return;
  }

  let folder = root;
  folder.count++;
  for (const segment of segments)
  {
    let child = folder.children.get(segment);
    if (!child)
    {
      child = { children: new Map(), files: [], count: 0 };
      folder.children.set(segment, child);
    }
    folder = child;
    folder.count++;
  }
  folder.files.push(file);
}

const byName = (a: string, b: string): number => a.localeCompare(b);

/**
 * Walk down through folders that contain nothing but one other folder, returning the
 * one to actually draw and the label that names the whole chain.
 */
function collapseChain<T extends PathEntry>(
  name: string,
  folder: Folder<T>
): { name: string; folder: Folder<T> }
{
  let label = name;
  let at = folder;
  while (at.files.length === 0 && at.children.size === 1)
  {
    const [childName, child] = [...at.children.entries()][0]!;
    label = `${label}/${childName}`;
    at = child;
  }
  return { name: label, folder: at };
}

/** The rows the list draws, in order, with everything inside a collapsed folder left out. */
export function buildFileRows<T extends PathEntry>(
  files: readonly T[],
  options: FileRowOptions
): FileRow<T>[]
{
  if (options.view === VIEW_FLAT)
  {
    return files.map((file) =>
    {
      const { dir, name } = splitPath(file.path);
      return { kind: ROW_KIND_FILE, key: file.path, label: name, dir, depth: 0, file, count: 0, expanded: false };
    });
  }

  const root: Folder<T> = { children: new Map(), files: [], count: 0 };
  for (const file of files)
  {
    insert(root, file);
  }

  const rows: FileRow<T>[] = [];

  const emit = (folder: Folder<T>, path: string, depth: number): void =>
  {
    // Folders above files, so the shape of the tree is visible before its contents:
    // the same reason a file manager groups directories first.
    const folders = [...folder.children.entries()].sort((a, b) => byName(a[0], b[0]));

    for (const [name, child] of folders)
    {
      let merged;
      if (options.dense)
      {
        merged = collapseChain(name, child);
      }
      else
      {
        merged = { name, folder: child };
      }
      const key = `${path}${merged.name}/`;
      const expanded = !options.collapsed.has(key);

      rows.push({
        kind: ROW_KIND_FOLDER,
        key,
        label: merged.name,
        dir: '',
        depth,
        count: merged.folder.count,
        expanded
      });

      if (expanded)
      {
        emit(merged.folder, key, depth + 1);
      }
    }

    for (const file of [...folder.files].sort((a, b) => byName(a.path, b.path)))
    {
      rows.push({
        kind: ROW_KIND_FILE,
        key: file.path,
        label: splitPath(file.path).name,
        dir: '',
        depth,
        file,
        count: 0,
        expanded: false
      });
    }
  };

  emit(root, '', 0);
  return rows;
}

/**
 * How a file list is shaped: by directory, or by some other property. The two path
 * shapes are the tree walk above; extension/status group one level deep, with none of the folder machinery.
 */
export type FileGrouping = 'flat' | 'tree' | 'extension' | 'status';

/** The extension group a path falls in, as a label. */
export function extensionOf(path: string): string
{
  const { name } = splitPath(path);
  const dot = name.lastIndexOf('.');
  // A leading dot is the whole name of a dotfile, not an extension of an empty one:
  // `.gitignore` groups under itself rather than under `gitignore`.
  if (dot <= 0)
  {
    if (name.startsWith('.'))
    {
      return name;
    }
    else
    {
      return '(no extension)';
    }
  }
  return name.slice(dot);
}

/**
 * Rows grouped one level deep by something that isn't the path: the same `FileRow`
 * shape as the tree. Group keys end in a slash and are prefixed, so `src` the group can't collide with `src` the folder.
 */
export const GROUP_PREFIX = 'group:';

export function buildGroupedFileRows<T extends PathEntry>(
  files: readonly T[],
  options: { groupOf: (file: T) => string; collapsed: ReadonlySet<string> }
): FileRow<T>[]
{
  const groups = new Map<string, T[]>();
  for (const file of files)
  {
    const label = options.groupOf(file);
    const bucket = groups.get(label);
    if (bucket)
    {
      bucket.push(file);
    }
    else
    {
      groups.set(label, [file]);
    }
  }

  const rows: FileRow<T>[] = [];
  for (const [label, bucket] of [...groups.entries()].sort((a, b) => byName(a[0], b[0])))
  {
    const key = `${GROUP_PREFIX}${label}/`;
    const expanded = !options.collapsed.has(key);
    rows.push({ kind: ROW_KIND_FOLDER, key, label, dir: '', depth: 0, count: bucket.length, expanded });
    if (!expanded)
    {
      continue;
    }

    for (const file of [...bucket].sort((a, b) => byName(a.path, b.path)))
    {
      const { dir, name } = splitPath(file.path);
      rows.push({ kind: ROW_KIND_FILE, key: file.path, label: name, dir, depth: 1, file, count: 0, expanded: false });
    }
  }
  return rows;
}

/**
 * The files a folder or group row holds: everything under it, nested folders
 * included. Answered from the entries, not the drawn rows, since a collapsed folder
 * draws none of its children yet is still "stage this folder"'s operand.
 */
export function filesInRow<T extends PathEntry>(
  files: readonly T[],
  key: string,
  groupOf?: (file: T) => string
): T[]
{
  if (key.startsWith(GROUP_PREFIX))
  {
    if (!groupOf)
    {
      return [];
    }
    const label = key.slice(GROUP_PREFIX.length, -1);
    return files.filter((file) => groupOf(file) === label);
  }
  // A folder key ends in a slash, so `src/` cannot also match a file called `src.txt`
  // or a sibling folder called `srclib/`.
  return files.filter((file) => file.path.startsWith(key));
}

/** Every folder key in the tree, for expand-all and collapse-all. */
export function allFolderKeys<T extends PathEntry>(
  files: readonly T[],
  options: Pick<FileRowOptions, 'dense'>
): string[]
{
  // Built by asking for the rows with nothing collapsed, so the keys can never disagree
  // with the ones the rows actually carry: including how dense merging renamed them.
  return buildFileRows(files, { view: VIEW_TREE, dense: options.dense, collapsed: new Set() })
    .filter((row) => row.kind === ROW_KIND_FOLDER)
    .map((row) => row.key);
}
