import type { TreeEntry } from '@shared/tree.js';
import { isSubmoduleMode } from '@shared/mode.js';
import { OBJECT_KIND_BLOB, OBJECT_KIND_SUBMODULE } from '@shared/types.js';
import { splitNul } from './common.js';

const OBJECT_TYPE_TREE = 'tree';
const OBJECT_TYPE_COMMIT = 'commit';

/**
 * Parse `git ls-tree -r -z`: mode type sha\tpath. Type: commit is submodule,
 * tree is folder (none arrive with -r). No tree records in output.
 */
export function parseLsTree(text: string): TreeEntry[]
{
  const entries: TreeEntry[] = [];

  for (const record of splitNul(text))
  {
    const tab = record.indexOf('\t');
    if (tab === -1)
    {
      continue;
    }

    const [mode = '', type = ''] = record.slice(0, tab).split(' ');
    // Tree record: folder git listed; -r should mean none arrive.
    if (type === OBJECT_TYPE_TREE)
    {
      continue;
    }

    let kind: typeof OBJECT_KIND_SUBMODULE | typeof OBJECT_KIND_BLOB;
    if (type === OBJECT_TYPE_COMMIT)
    {
      kind = OBJECT_KIND_SUBMODULE;
    }
    else
    {
      kind = OBJECT_KIND_BLOB;
    }
    entries.push({
      path: record.slice(tab + 1),
      kind,
      mode
    });
  }

  return entries;
}

/**
 * Parse `git ls-files --stage -z`: mode sha stage\tpath. No type field;
 * 160000 is gitlink mode (submodule). First conflict stage wins.
 */
export function parseLsFilesStage(text: string): TreeEntry[]
{
  const entries: TreeEntry[] = [];
  const seen = new Set<string>();

  for (const record of splitNul(text))
  {
    const tab = record.indexOf('\t');
    if (tab === -1)
    {
      continue;
    }

    const path = record.slice(tab + 1);
    if (seen.has(path))
    {
      continue;
    }
    seen.add(path);

    const [mode = ''] = record.slice(0, tab).split(' ');
    let kind: typeof OBJECT_KIND_SUBMODULE | typeof OBJECT_KIND_BLOB;
    if (isSubmoduleMode(mode))
    {
      kind = OBJECT_KIND_SUBMODULE;
    }
    else
    {
      kind = OBJECT_KIND_BLOB;
    }
    entries.push({
      path,
      kind,
      mode
    });
  }

  return entries;
}

/**
 * Parse `git ls-files -u -z` (unmerged index entries) into a unique path list.
 *
 * Each conflicted path appears once per stage (base/ours/theirs), so duplicates are
 * expected and collapsed here.
 */
export function parseUnmergedPaths(text: string): string[]
{
  const paths = new Set<string>();
  for (const entry of splitNul(text))
  {
    // "<mode> <sha> <stage>\t<path>"
    const tab = entry.indexOf('\t');
    if (tab !== -1)
    {
      paths.add(entry.slice(tab + 1));
    }
  }
  return [...paths];
}
