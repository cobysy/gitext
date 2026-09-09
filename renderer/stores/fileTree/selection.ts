/**
 * Tree listing and selection. No API calls: keeps select/selectPaths unit-testable.
 */

import { computed, ref } from 'vue';
import type { TreeEntry } from '@shared/tree.js';
import { createCollapsedFolders } from '@renderer/collapsedFolders.js';
import {
  EMPTY_SELECTION,
  MODE_REPLACE,
  pickPath,
  pickPaths,
  type MultiSelectMode,
  type PathSelection,
  type SelectMode
} from '@renderer/pathSelection.js';
import type { useFilePaneStore } from '@renderer/stores/filePane.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';


export interface SelectionDeps {
  pane: ReturnType<typeof useFilePaneStore>;
  settings: ReturnType<typeof useSettingsStore>;
}

export function createSelectionState({ pane, settings }: SelectionDeps)
{
  const entries = ref<TreeEntry[]>([]);

  /** The same multi-selection the changed list has, for the same reason: see `diff/selection.ts`. */
  const selection = ref<PathSelection>(EMPTY_SELECTION);
  /** The paths the tree is drawing, in draw order, reported by the component. */
  const order = ref<string[]>([]);

  /**
   * Folders whose contents are hidden, by key.
   *
   * The opposite default from the changed-files list: that one holds the handful of files
   * a commit touched and opens flat, while this one holds every file in the repository and
   * would otherwise draw a thousand rows on the first click. So a fresh listing starts
   * with everything collapsed, and what has been opened survives the next revision: the
   * keys are paths, and a path does not move when the selection does.
   */
  const folders = createCollapsedFolders(
    () => entries.value,
    () => settings.settings.fileListDenseTree
  );
  const collapsedFolders = folders.keys;

  /**
   * The file being shown, by path: never by index, as the listing reloads.
   *
   * Derived from the path that was asked for, shared with the changed-file list: the same
   * file stays open across revisions and across a switch between the two lists, and a
   * revision that does not contain it shows nothing rather than a file nobody picked:
   * there is no useful "first file" in a whole repository, and the top of an alphabetical
   * listing is a dotfile. See `stores/filePane.ts`.
   */
  const selectedPath = computed<string | null>(() =>
  {
    const wanted = pane.wantedPath;
    if (wanted !== null && entries.value.some((entry) => entry.path === wanted))
    {
      return wanted;
    }
    else
    {
      return null;
    }
  });

  const selectedPaths = computed<string[]>(() =>
  {
    const present = new Set(entries.value.map((entry) => entry.path));
    const picked = selection.value.picks.filter((path) => present.has(path));
    if (picked.length > 0)
    {
      return picked;
    }
    if (selectedPath.value === null)
    {
      return [];
    }
    else
    {
      return [selectedPath.value];
    }
  });

  const selectedEntries = computed<TreeEntry[]>(() =>
  {
    const wanted = new Set(selectedPaths.value);
    return entries.value.filter((entry) => wanted.has(entry.path));
  });

  const selectedEntry = computed<TreeEntry | null>(
    () => entries.value.find((entry) => entry.path === selectedPath.value) ?? null
  );

  function drawnPaths(): string[]
  {
    if (order.value.length > 0)
    {
      return order.value;
    }
    else
    {
      return entries.value.map((entry) => entry.path);
    }
  }

  function setOrder(paths: readonly string[]): void
  {
    order.value = [...paths];
  }

  function select(path: string | null, mode: SelectMode = MODE_REPLACE): void
  {
    if (path === null)
    {
      selection.value = EMPTY_SELECTION;
      pane.want(null);
      return;
    }
    selection.value = pickPath(selection.value, path, mode, drawnPaths());
    const picks = selection.value.picks;
    pane.want(picks[picks.length - 1] ?? path);
  }

  function selectPaths(paths: readonly string[], mode: MultiSelectMode = MODE_REPLACE): void
  {
    if (paths.length === 0)
    {
      return;
    }
    selection.value = pickPaths(selection.value, paths, mode);
    const picks = selection.value.picks;
    if (picks.length > 0)
    {
      pane.want(picks[picks.length - 1]!);
    }
  }

  function reset(): void
  {
    entries.value = [];
    selection.value = EMPTY_SELECTION;
    order.value = [];
    pane.forget();
    folders.expandAll();
  }

  return {
    entries,
    selection,
    order,
    collapsedFolders,
    selectedPath,
    selectedPaths,
    selectedEntries,
    selectedEntry,
    drawnPaths,
    setOrder,
    select,
    selectPaths,
    toggleFolder: folders.toggle,
    expandAll: folders.expandAll,
    collapseAll: folders.collapseAll,
    reset
  };
}

export type SelectionState = ReturnType<typeof createSelectionState>;
