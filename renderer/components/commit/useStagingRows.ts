/**
 * What the file list draws: filter, view mode (flat/tree/grouped), collapsed folders, status letters and flags.
 * Separate from selection (`useStagingSelection.ts`) and menus.
 */

import { computed, ref, watch } from 'vue';
import type { DiffFileEntry } from '@shared/diff.js';
import {
  ROW_KIND_FILE,
  VIEW_FLAT,
  VIEW_TREE,
  buildFileRows,
  buildGroupedFileRows,
  filesInRow,
  type FileRow
} from '@renderer/filetree.js';
import {
  GROUP_VIEW_EXTENSION,
  GROUP_VIEW_STATUS,
  groupHeadingOf,
  isGroupView
} from '@renderer/model/fileGroups.js';
import { toFilePath } from '@renderer/model/paths.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useStagingStore, type StagingSide } from '@renderer/stores/staging.js';

/** The letter git's own status output uses, so the list reads like `git status -s`. */
const STATUS_LETTERS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflicted: 'U',
  typechange: 'T',
  unchanged: ' '
};


export interface StagingRowsOptions {
  side: () => StagingSide;
  files: () => DiffFileEntry[];
}

export function useStagingRows(opts: StagingRowsOptions)
{
  const staging = useStagingStore();
  const settings = useSettingsStore();

  const filter = ref('');

  const shown = computed(() =>
  {
    const needle = filter.value.trim().toLowerCase();
    if (!needle)
    {
      return opts.files();
    }
    return opts.files().filter((file) => file.path.toLowerCase().includes(needle));
  });

  /** Folder and group keys this list is hiding the contents of. */
  const collapsed = ref(new Set<string>());

  function toggleFolder(key: string): void
  {
    // Reassigned rather than mutated: a Set is not deeply reactive, so the rows built
    // from it would not rebuild.
    const next = new Set(collapsed.value);
    if (!next.delete(key))
    {
      next.add(key);
    }
    collapsed.value = next;
  }

  /**
   * Drawn rows in the current view mode. Filter forces flat (collapsed folder would hide matches).
   */
  const view = computed(() =>
  {
    if (filter.value.trim())
    {
      return VIEW_FLAT;
    }
    else
    {
      return settings.settings.stagingListView;
    }
  }
  );

  /** The heading a file falls under, for both the rows and `filesInRow`. */
  function groupOf(file: DiffFileEntry): string
  {
    if (isGroupView(view.value))
    {
      return groupHeadingOf(file, view.value);
    }
    return '';
  }

  const rows = computed<FileRow<DiffFileEntry>[]>(() =>
  {
    switch (view.value)
    {
      case GROUP_VIEW_EXTENSION:
      case GROUP_VIEW_STATUS:
        return buildGroupedFileRows(shown.value, { groupOf, collapsed: collapsed.value });
      case VIEW_TREE:
        return buildFileRows(shown.value, {
          view: VIEW_TREE,
          dense: settings.settings.stagingDenseTree,
          collapsed: collapsed.value
        });
      default:
        return buildFileRows(shown.value, {
          view: VIEW_FLAT,
          dense: settings.settings.stagingDenseTree,
          collapsed: collapsed.value
        });
    }
  });

  /**
   * Tell the store the drawn row order, so shift-range and arrow keys measure against what's on screen.
   */
  watch(
    rows,
    (list) =>
    {
      staging.setOrder(
        opts.side(),
        list.filter((row) => row.kind === ROW_KIND_FILE).map((row) => row.key)
      );
    },
    { immediate: true }
  );

  function letterOf(file: DiffFileEntry): string
  {
    return STATUS_LETTERS[file.status] ?? '?';
  }

  /**
   * Mark files git is ignoring for changes (skip-worktree, assume-unchanged) so they're not confused with untracked.
   */
  // Sets rather than the store's arrays, because every row asks: two `includes` per row
  // down a list of hundreds is a scan of the flagged paths for each of them.
  const skipWorktree = computed(() => new Set(staging.skipWorktree));
  const assumeUnchanged = computed(() => new Set(staging.assumeUnchanged));

  function flagOf(file: DiffFileEntry): string
  {
    if (skipWorktree.value.has(toFilePath(file.path)))
    {
      return 'S';
    }
    if (assumeUnchanged.value.has(toFilePath(file.path)))
    {
      return 'h';
    }
    return '';
  }

  function flagTitle(file: DiffFileEntry): string
  {
    if (skipWorktree.value.has(toFilePath(file.path)))
    {
      return 'Skip worktree: git will not take updates to this file';
    }
    else
    {
      return 'Assume unchanged: git is not checking this file for changes';
    }
  }

  /** The files a folder or group row stands for, in the order the list draws them. */
  function filesUnder(key: string): DiffFileEntry[]
  {
    return filesInRow(shown.value, key, groupOf);
  }

  function pathsUnder(key: string): string[]
  {
    return filesUnder(key).map((file) => file.path);
  }

  function wholly(files: DiffFileEntry[], isSelected: (path: string) => boolean): boolean
  {
    return files.length > 0 && files.every((file) => isSelected(file.path));
  }

  /** A folder is selected when everything in it is: there is no half-tick here. */
  function isFolderSelected(key: string, isSelected: (path: string) => boolean): boolean
  {
    return wholly(filesUnder(key), isSelected);
  }

  /**
   * Whether the folder row draws as selected (different from "is selected"): skip if one file (would confuse a click).
   */
  function isFolderHighlighted(key: string, isSelected: (path: string) => boolean): boolean
  {
    const files = filesUnder(key);
    return files.length > 1 && wholly(files, isSelected);
  }

  return {
    filter,
    shown,
    rows,
    toggleFolder,
    letterOf,
    flagOf,
    flagTitle,
    filesUnder,
    pathsUnder,
    isFolderSelected,
    isFolderHighlighted
  };
}
