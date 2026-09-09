/**
 * The changed-file list itself, and what is picked in it.
 *
 * One responsibility: what the list currently holds, which paths are picked, which
 * folders the tree view is hiding, and which single file the diff pane follows.
 * Loading the list is `files.ts`'s job; reading a patch for the followed file is
 * `patch.ts`'s. Nothing here talks to `api`, which is what keeps `select` and
 * `selectPaths` unit-testable with no fake backend at all.
 */

import { computed, ref } from 'vue';
import {
  EMPTY_SELECTION,
  MODE_REPLACE,
  pickPath,
  pickPaths,
  type MultiSelectMode,
  type PathSelection,
  type SelectMode
} from '@renderer/pathSelection.js';
import { createCollapsedFolders } from '@renderer/collapsedFolders.js';
import type { DiffFileEntry } from '@shared/diff.js';
import { FILES_PANE_MODE_TREE } from '@shared/types.js';
import type { useFilePaneStore } from '@renderer/stores/filePane.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';

export interface SelectionDeps {
  pane: ReturnType<typeof useFilePaneStore>;
  settings: ReturnType<typeof useSettingsStore>;
}

export function createSelectionState({ pane, settings }: SelectionDeps)
{
  const files = ref<DiffFileEntry[]>([]);

  /**
   * Everything the list has picked, and the anchor a shift-click measures from: the
   * same module (`renderer/pathSelection.ts`) the commit screen's lists use, so a
   * shift-drag behaves identically on both screens.
   *
   * Distinct from `selectedPath`, the one file the *diff pane* is showing: a five-file
   * selection still shows one diff.
   */
  const picked = ref<PathSelection>(EMPTY_SELECTION);

  /**
   * The paths the list is drawing, in draw order, reported by the component: a
   * shift-range means "between these two rows on screen", and the rows aren't the file
   * list (a tree/grouping reorders, a filter/collapsed folder hides).
   */
  const order = ref<string[]>([]);

  /**
   * Folders whose contents the tree view is hiding. Here, not the component, since
   * expand-all/collapse-all act on it, and a command must not reach into a component.
   */
  const folders = createCollapsedFolders(
    () => files.value,
    () => settings.settings.fileListDenseTree
  );
  const collapsedFolders = folders.keys;

  /**
   * The file the diff viewer is showing, by path, never by index. Derived, not stored,
   * from the path that was *asked* for: the wanted file when this range changed it, the
   * first changed file otherwise, so selecting a commit shows a diff, not an empty pane.
   */
  const selectedPath = computed<string | null>(() =>
  {
    const wanted = pane.wantedPath;
    if (wanted !== null && files.value.some((file) => file.path === wanted))
    {
      return wanted;
    }
    // The fallback belongs to *this* list: picking the first changed file makes
    // selecting a commit show a diff, but in tree mode the wanted path may not be
    // among this commit's files, so there's no diff for it.
    if (settings.settings.filesPaneMode === FILES_PANE_MODE_TREE)
    {
      return null;
    }
    return files.value[0]?.path ?? null;
  });

  /** The files a command acts on: what's picked, or the one on screen when nothing is, so arrowing to a file and hitting `S` stages it without a click first. */
  const selectedPaths = computed<string[]>(() =>
  {
    const present = new Set(files.value.map((file) => file.path));
    const here = picked.value.picks.filter((path) => present.has(path));
    if (here.length > 0)
    {
      return here;
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

  const selectedEntries = computed<DiffFileEntry[]>(() =>
  {
    const wanted = new Set(selectedPaths.value);
    return files.value.filter((file) => wanted.has(file.path));
  });

  const selectedFile = computed<DiffFileEntry | null>(
    () => files.value.find((file) => file.path === selectedPath.value) ?? null
  );

  function drawnPaths(): string[]
  {
    if (order.value.length > 0)
    {
      return order.value;
    }
    else
    {
      return files.value.map((file) => file.path);
    }
  }

  function setOrder(paths: readonly string[]): void
  {
    order.value = [...paths];
  }

  /**
   * Pick a file, in one of the three click modes. The *last* pick becomes the wanted
   * path, so the diff pane follows the row under the pointer, not the far end of a shift-drag.
   */
  function select(path: string | null, mode: SelectMode = MODE_REPLACE): void
  {
    if (path === null)
    {
      picked.value = EMPTY_SELECTION;
      pane.want(null);
      return;
    }
    picked.value = pickPath(picked.value, path, mode, drawnPaths());
    const picks = picked.value.picks;
    pane.want(picks[picks.length - 1] ?? path);
  }

  /**
   * Pick a folderful at once: the operand a folder row hands the file commands.
   * "Stage this folder" needs no command of its own, just the ordinary multi-file stage.
   */
  function selectPaths(paths: readonly string[], mode: MultiSelectMode = MODE_REPLACE): void
  {
    if (paths.length === 0)
    {
      return;
    }
    picked.value = pickPaths(picked.value, paths, mode);
    const picks = picked.value.picks;
    if (picks.length > 0)
    {
      pane.want(picks[picks.length - 1]!);
    }
  }

  function reset(): void
  {
    files.value = [];
    picked.value = EMPTY_SELECTION;
    order.value = [];
    folders.expandAll();
    pane.forget();
  }

  return {
    files,
    picked,
    order,
    collapsedFolders,
    selectedPath,
    selectedPaths,
    selectedEntries,
    selectedFile,
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
