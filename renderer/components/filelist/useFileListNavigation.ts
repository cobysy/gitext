/**
 * What the file pane currently has drawn, and the keyboard/mouse over it.
 *
 * Covers the filter box, the tree-or-flat row build, the virtualizer, and focus: arrow
 * keys, click, and the folder-selection helpers a right-click needs. Pulled out of
 * `ChangedFiles.vue` because "what is on screen and where the keyboard is within it" is
 * one coherent reason to change, independent of which underlying list backs the pane
 * (`usePaneSource.ts`) or how a click turns into a menu, which stay the component's
 * business.
 */

import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  ROW_KIND_FILE,
  ROW_KIND_FOLDER,
  VIEW_FLAT,
  buildFileRows,
  buildGroupedFileRows,
  filesInRow,
  parentKey,
  type FileRow
} from '@renderer/filetree.js';
import { groupHeadingOf, isGroupView } from '@renderer/model/fileGroups.js';
import { KEY_ARROW_DOWN, KEY_ARROW_LEFT, KEY_ARROW_RIGHT, KEY_ARROW_UP, KEY_END, KEY_ESCAPE, KEY_HOME, isModPressed } from '@renderer/keys.js';
import { MODE_RANGE, MODE_REPLACE, MODE_TOGGLE, type SelectMode } from '@renderer/pathSelection.js';
import type { PaneEntry } from '@renderer/model/fileRowDescription.js';

/** Fixed row height, for the virtualizer's estimate and the row's own inline style. */
export const ROW_HEIGHT = 22;

/** The four shapes the list can draw, matching the `fileListView` setting. */
export type FileListView = 'flat' | 'tree' | 'extension' | 'status';

export interface FileListNavigationOptions {
  source: () => PaneEntry[];
  collapsed: () => ReadonlySet<string>;
  fileListView: () => FileListView;
  dense: () => boolean;
  selectedPath: () => string | null;
  selectPath: (path: string | null, mode?: SelectMode) => void;
  pickedHere: () => ReadonlySet<string>;
  toggleFolder: (key: string) => void;
  /** The list tells the store what it drew, in whichever mode it is in. */
  setOrder: (paths: string[]) => void;
  /** Escape's other half: see `stopFollowing` in the component. */
  following: () => boolean;
  stopFollowing: () => void;
  /** The scroll container, so the virtualizer can measure it and scroll it. */
  scroller: Ref<HTMLElement | null>;
}

export function useFileListNavigation(opts: FileListNavigationOptions)
{
  const filter = ref('');

  const matching = computed<PaneEntry[]>(() =>
  {
    const term = filter.value.trim().toLowerCase();
    if (!term)
    {
      return opts.source();
    }
    return opts.source().filter((file) => file.path.toLowerCase().includes(term));
  });

  /**
   * The shape to draw. A filter forces the flat shape, whatever the setting says: a
   * tree of one match per folder is mostly folders, and a collapsed one could hide a
   * match, answering "nothing" while holding the file you asked for.
   */
  const view = computed<FileListView>(() =>
  {
    if (filter.value.trim())
    {
      return VIEW_FLAT;
    }
    return opts.fileListView();
  });

  /** The heading an entry falls under, for both the rows and `filesInRow`. */
  function groupOf(entry: PaneEntry): string
  {
    if (isGroupView(view.value))
    {
      return groupHeadingOf(entry, view.value);
    }
    return '';
  }

  const rows = computed<FileRow<PaneEntry>[]>(() =>
  {
    if (isGroupView(view.value))
    {
      return buildGroupedFileRows<PaneEntry>(matching.value, {
        groupOf,
        collapsed: opts.collapsed()
      });
    }
    return buildFileRows<PaneEntry>(matching.value, {
      view: view.value,
      dense: opts.dense(),
      collapsed: opts.collapsed()
    });
  }
  );

  /**
   * The list tells the store what it drew. A shift-range means "between these two rows
   * on screen", and the rows aren't the file list: a tree reorders them, a filter
   * removes some, a collapsed folder hides the rest.
   */
  watch(
    rows,
    (list) =>
    {
      opts.setOrder(list.filter((row) => row.kind === ROW_KIND_FILE).map((row) => row.key));
    },
    { immediate: true }
  );

  const virtualizer = useVirtualizer(
    computed(() => ({
      count: rows.value.length,
      getScrollElement: () => opts.scroller.value,
      estimateSize: () => ROW_HEIGHT,
      overscan: 12
    }))
  );

  const virtualRows = computed(() => virtualizer.value.getVirtualItems());
  const totalHeight = computed(() => virtualizer.value.getTotalSize());
  const fileCount = computed(() => matching.value.length);

  // ── Focus and selection ──────────────────────────────────────────────────────

  /**
   * The row the keyboard is on. Distinct from the selected *file*: a folder row can be
   * focused with no diff to show. Focusing a file selects it, which is what makes arrows walk the diffs too.
   */
  const focusedKey = ref<string | null>(null);

  // The changed-files store picks the first file when its list loads; follow whichever list
  // is showing, so the keyboard starts where the pane is rather than at the top of the tree.
  watch(
    opts.selectedPath,
    (path) =>
    {
      if (path && path !== focusedKey.value)
      {
        focusedKey.value = path;
      }
    },
    { immediate: true }
  );

  /** The folder keys above a path, innermost first: the ones that could be hiding it. */
  function ancestorKeys(path: string): string[]
  {
    const keys: string[] = [];
    for (let key = parentKey(path); key !== null; key = parentKey(key))
    {
      keys.push(key);
    }
    return keys;
  }

  /**
   * Keep the open file where it can be seen: selecting a different revision rebuilds
   * the list under it, and the pane's file can land anywhere in the new one, or inside a
   * closed folder. So the ancestor folders open and the list scrolls to it, like the
   * grid does with the selected commit.
   *
   * Watched on the entries too, not just the path: the usual case is the same file, a
   * different revision, a different row.
   */
  watch([opts.selectedPath, opts.source, filter], async ([path]) =>
  {
    if (path === null)
    {
      return;
    }

    // Opened first: a row inside a collapsed folder is not drawn, so there is no index to
    // scroll to. Tree mode arrives collapsed by design and would otherwise hide it always.
    for (const key of ancestorKeys(path))
    {
      if (opts.collapsed().has(key))
      {
        opts.toggleFolder(key);
      }
    }

    await nextTick();
    const index = rows.value.findIndex((row) => row.key === path);
    // `align: 'auto'` scrolls only when the row is off screen, so a refresh that changed
    // nothing about where the file sits leaves the list where it was.
    if (index >= 0)
    {
      virtualizer.value.scrollToIndex(index, { align: 'auto' });
    }
  });

  /** The files a folder or group row stands for, in the order the list draws them. */
  function filesUnder(key: string): PaneEntry[]
  {
    return filesInRow(matching.value, key);
  }

  function pathsUnder(key: string): string[]
  {
    return filesUnder(key).map((file) => file.path);
  }

  /** A folder is selected when everything in it is: there is no half-tick here. */
  function isFolderSelected(key: string): boolean
  {
    const paths = pathsUnder(key);
    return paths.length > 0 && paths.every((path) => opts.pickedHere().has(path));
  }

  /**
   * Whether a folder row *draws* as selected, which isn't quite the same question: a
   * single-file folder would light up whenever that file is clicked, saying nothing
   * new. Past one file the derived rule earns its highlight.
   */
  function isFolderHighlighted(key: string): boolean
  {
    return pathsUnder(key).length > 1 && isFolderSelected(key);
  }

  function onRowClick(row: FileRow<PaneEntry>, event: MouseEvent): void
  {
    focusedKey.value = row.key;
    if (row.kind === ROW_KIND_FOLDER)
    {
      opts.toggleFolder(row.key);
      return;
    }
    let mode: typeof MODE_RANGE | typeof MODE_TOGGLE | typeof MODE_REPLACE;
    if (event.shiftKey)
    {
      mode = MODE_RANGE;
    }
    else if (isModPressed(event))
    {
      mode = MODE_TOGGLE;
    }
    else
    {
      mode = MODE_REPLACE;
    }
    opts.selectPath(row.key, mode);
  }

  function focusRow(row: FileRow<PaneEntry> | undefined, extend = false): void
  {
    if (!row)
    {
      return;
    }
    focusedKey.value = row.key;
    // Shift-arrow grows the range from the anchor, exactly as a shift-click does.
    if (row.kind === ROW_KIND_FILE)
    {
      let mode: typeof MODE_RANGE | typeof MODE_REPLACE;
      if (extend)
      {
        mode = MODE_RANGE;
      }
      else
      {
        mode = MODE_REPLACE;
      }
      opts.selectPath(row.key, mode);
    }

    const index = rows.value.indexOf(row);
    if (index >= 0)
    {
      virtualizer.value.scrollToIndex(index, { align: 'auto' });
    }
  }

  /**
   * Up/down move, left/right open and close a folder: the tree conventions the left
   * panel already follows. Bare keys only; anything with a modifier belongs to the registry.
   */
  /** Any modifier at all: bare-key navigation defers to the registry once one is held. */
  function hasModifierKey(event: KeyboardEvent): boolean
  {
    return event.ctrlKey || event.metaKey || event.altKey;
  }

  function onKeydown(event: KeyboardEvent): void
  {
    if (hasModifierKey(event))
    {
      return;
    }

    const current = rows.value.findIndex((row) => row.key === focusedKey.value);
    const row = rows.value[current];

    switch (event.key)
    {
      case KEY_ARROW_DOWN:
        event.preventDefault();
        focusRow(rows.value[Math.min(rows.value.length - 1, current + 1)], event.shiftKey);
        return;
      case KEY_ARROW_UP:
        event.preventDefault();
        focusRow(rows.value[Math.max(0, current - 1)], event.shiftKey);
        return;
      case KEY_ARROW_RIGHT:
        event.preventDefault();
        if (row?.kind === ROW_KIND_FOLDER && !row.expanded)
        {
          opts.toggleFolder(row.key);
        }
        else if (row?.kind === ROW_KIND_FOLDER)
        {
          focusRow(rows.value[current + 1]);
        }
        return;
      case KEY_ARROW_LEFT: {
        event.preventDefault();
        if (row?.kind === ROW_KIND_FOLDER && row.expanded)
        {
          opts.toggleFolder(row.key);
          return;
        }
        // Otherwise step out to the folder this row is in, which is where a collapse would
        // leave you.
        let parent;
        if (row)
        {
          parent = parentKey(row.key);
        }
        else
        {
          parent = null;
        }
        if (parent)
        {
          focusRow(rows.value.find((candidate) => candidate.key === parent));
        }
        return;
      }
      case KEY_HOME:
        event.preventDefault();
        focusRow(rows.value[0]);
        return;
      case KEY_END:
        event.preventDefault();
        focusRow(rows.value[rows.value.length - 1]);
        return;
      case KEY_ESCAPE:
        // The keyboard's half of the clear button beside the heading.
        if (opts.following())
        {
          event.preventDefault();
          opts.stopFollowing();
        }
        return;
      default:
    }
  }

  return {
    filter,
    matching,
    rows,
    virtualRows,
    totalHeight,
    fileCount,
    focusedKey,
    filesUnder,
    pathsUnder,
    isFolderSelected,
    isFolderHighlighted,
    onRowClick,
    focusRow,
    onKeydown
  };
}
