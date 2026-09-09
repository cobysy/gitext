/**
 * Fold flat list of leaves into folders and sort. Domain-independent:
 * knows only sortName/sortDate and PanelNode.
 */

import type { PanelNode, TreeOptions } from '../types.js';

const SORT_DATE = 'date';

/** Leaf plus sort keys (dropped after sorting). */
export interface SortableLeaf {
  /** Path for folding and name for sorting. */
  sortName: string;
  sortDate: number;
  node: PanelNode;
}

function direction(options: TreeOptions): number
{
  if (options.ascending)
  {
    return 1;
  }
  else
  {
    return -1;
  }
}

function compareNames(a: string, b: string): number
{
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortLeaves(leaves: SortableLeaf[], options: TreeOptions): SortableLeaf[]
{
  return [...leaves].sort((a, b) =>
  {
    if (options.sort === SORT_DATE)
    {
      // Newest first when ascending is off; name tiebreaker keeps order stable.
      const byDate = (a.sortDate - b.sortDate) * direction(options);
      if (byDate !== 0)
      {
        return byDate;
      }
      return compareNames(a.sortName, b.sortName);
    }
    return compareNames(a.sortName, b.sortName) * direction(options);
  });
}

/**
 * Fold `feature/x` into a `feature` folder containing `x`.
 *
 * The folder tree is built from the leaves' own names, so a folder exists exactly when
 * something is in it: there is no separate list of folders to fall out of step. The
 * same function serves branches, each remote's branches, tags and submodules; they
 * differ only in what a leaf is.
 */
export function foldPaths(leaves: SortableLeaf[], idPrefix: string, options: TreeOptions): PanelNode[]
{
  interface Folder {
    children: Map<string, Folder>;
    leaves: SortableLeaf[];
  }
  const root: Folder = { children: new Map(), leaves: [] };

  for (const leaf of leaves)
  {
    const segments = leaf.sortName.split('/');
    const last = segments.pop();
    if (last === undefined)
    {
      continue;
    }

    let folder = root;
    for (const segment of segments)
    {
      let child = folder.children.get(segment);
      if (!child)
      {
        child = { children: new Map(), leaves: [] };
        folder.children.set(segment, child);
      }
      folder = child;
    }
    // Label is last segment; full name stays on node for commands.
    folder.leaves.push({ ...leaf, sortName: last, node: { ...leaf.node, label: last } });
  }

  const emit = (folder: Folder, path: string): PanelNode[] =>
  {
    const folders = [...folder.children.entries()]
      .map(([name, child]) => ({
        name,
        node: {
          id: `folder:${idPrefix}:${path}${name}`,
          kind: 'folder' as const,
          label: name,
          children: emit(child, `${path}${name}/`)
        }
      }))
      // Folders sort by name: no date, inventing one would reorder as commits land.
      .sort((a, b) =>
      {
        let sign: number;
        if (options.sort === SORT_DATE)
        {
          sign = 1;
        }
        else
        {
          sign = direction(options);
        }
        return compareNames(a.name, b.name) * sign;
      })
      .map((entry) => entry.node);

    // Folders above leaves: shows namespace shape before contents.
    return [...folders, ...sortLeaves(folder.leaves, options).map((entry) => entry.node)];
  };

  return emit(root, '');
}
