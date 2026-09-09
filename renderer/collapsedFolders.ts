/**
 * Which folders a tree view is hiding, and the four things anyone ever does to that
 * set. Three lists had written this out: the changed-file pane, the commit screen's
 * file tree, and the conflict list, each with its own copy of the same six lines and
 * the same comment explaining the reassignment.
 *
 * Not a store: each list collapses independently, so this is state a caller owns, in
 * the same shape `renderer/pathSelection.ts` supplies the *other* half of a file list's
 * state. The entries and the dense flag come in as getters rather than values, since
 * `collapseAll` has to ask what the list holds at the moment it is clicked.
 */

import { ref, type Ref } from 'vue';
import { allFolderKeys, type PathEntry } from '@renderer/filetree.js';

export interface CollapsedFolders {
  /** Folder keys whose contents are hidden. Read by `buildFileRows`' `collapsed`. */
  readonly keys: Ref<Set<string>>;
  toggle: (key: string) => void;
  /** Nothing hidden. Also what a list resets to once it has been emptied or reloaded. */
  expandAll: () => void;
  collapseAll: () => void;
}

export function createCollapsedFolders<T extends PathEntry>(
  entries: () => readonly T[],
  dense: () => boolean
): CollapsedFolders
{
  const keys = ref(new Set<string>());

  function toggle(key: string): void
  {
    // Reassigned rather than mutated: a `Set` is not deeply reactive, so the rows built
    // from it would not rebuild.
    const next = new Set(keys.value);
    if (!next.delete(key))
    {
      next.add(key);
    }
    keys.value = next;
  }

  function expandAll(): void
  {
    keys.value = new Set();
  }

  function collapseAll(): void
  {
    keys.value = new Set(allFolderKeys(entries(), { dense: dense() }));
  }

  return { keys, toggle, expandAll, collapseAll };
}
