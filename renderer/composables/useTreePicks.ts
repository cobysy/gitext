/**
 * A manager's list of things with slash-separated names, folded into folders, and which
 * of them are picked. Picked the way a file list is (`pathSelection.ts`): a click picks
 * one, Cmd toggles, Shift extends over the rows as drawn, and a folder row picks
 * everything under it, collapsed or not. That last one is what makes a hundred
 * `author/…` branches, or a directory of worktrees, one click rather than a hundred.
 *
 * Generic over the entry, so the branch and worktree managers give one answer about a
 * folder pick; each maps the picked keys back to its own entries.
 */

import { computed, ref, watch, type Ref } from 'vue';
import {
  buildFileRows,
  filesInRow,
  ROW_KIND_FILE,
  VIEW_TREE,
  type FileRow,
  type PathEntry
} from '@renderer/filetree.js';
import { createCollapsedFolders } from '@renderer/collapsedFolders.js';
import {
  EMPTY_SELECTION,
  MODE_REPLACE,
  MODE_TOGGLE,
  pickPath,
  pickPaths,
  selectModeOf,
  type PathSelection
} from '@renderer/pathSelection.js';

export interface TreePickOptions {
  /** Keys picked when the list first draws. */
  initial: readonly string[];
  /** Merge a folder holding only one other folder into one row: see `buildFileRows`. */
  dense: boolean;
}

export function useTreePicks<T extends PathEntry>(entries: Readonly<Ref<readonly T[]>>, options: TreePickOptions)
{
  const folders = createCollapsedFolders(() => entries.value, () => options.dense);

  const rows = computed<FileRow<T>[]>(() =>
    buildFileRows(entries.value, { view: VIEW_TREE, dense: options.dense, collapsed: folders.keys.value })
  );

  /** The entry rows in the order drawn: what a Shift-click measures along. */
  const order = computed(() =>
    rows.value.filter((row) => row.kind === ROW_KIND_FILE).map((row) => row.key)
  );

  let start: PathSelection<string> = EMPTY_SELECTION;
  if (options.initial.length > 0)
  {
    start = { picks: [...options.initial], anchor: options.initial[options.initial.length - 1]! };
  }
  const selection = ref<PathSelection<string>>(start);

  /** The picked keys, as a set: what a caller filters its own entries by. */
  const picks = computed<ReadonlySet<string>>(() => new Set(selection.value.picks));

  /** Picks that no longer name an entry are dropped: renamed or removed, here or elsewhere. */
  watch(entries, (now) =>
  {
    const present = new Set(now.map((entry) => entry.path));
    const kept = selection.value.picks.filter((key) => present.has(key));
    if (kept.length !== selection.value.picks.length)
    {
      selection.value = { picks: kept, anchor: kept[kept.length - 1] ?? null };
    }
  });

  function keysIn(folderKey: string): string[]
  {
    return filesInRow(entries.value, folderKey).map((entry) => entry.path);
  }

  function isPicked(row: FileRow<T>): boolean
  {
    if (row.kind === ROW_KIND_FILE)
    {
      return picks.value.has(row.key);
    }
    return keysIn(row.key).every((key) => picks.value.has(key));
  }

  function pickRow(row: FileRow<T>, event: MouseEvent): void
  {
    const mode = selectModeOf(event);
    if (row.kind === ROW_KIND_FILE)
    {
      selection.value = pickPath(selection.value, row.key, mode, order.value);
      return;
    }
    // A folder has no range: Shift on one is a plain pick of it.
    let folderMode: typeof MODE_TOGGLE | typeof MODE_REPLACE = MODE_REPLACE;
    if (mode === MODE_TOGGLE)
    {
      folderMode = MODE_TOGGLE;
    }
    selection.value = pickPaths(selection.value, keysIn(row.key), folderMode);
  }

  function pickKeys(keys: readonly string[]): void
  {
    selection.value = pickPaths(EMPTY_SELECTION, keys, MODE_REPLACE);
  }

  return { rows, picks, isPicked, pickRow, pickKeys, toggleFolder: folders.toggle };
}
