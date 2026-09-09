/**
 * File selection and moving between staging lists: click/shift/ctrl, arrows, row button, double-click.
 * Separate from rendering (`useStagingRows.ts`) and menus.
 */

import { computed } from 'vue';
import type { DiffFileEntry } from '@shared/diff.js';
import { toFilePath, type FilePath } from '@renderer/model/paths.js';
import { KEY_ARROW_DOWN, KEY_ARROW_UP, KEY_ENTER, KEY_SPACE } from '@renderer/keys.js';
import { MODE_RANGE, MODE_REPLACE, MODE_TOGGLE } from '@renderer/pathSelection.js';
import {
  STAGING_SIDE_STAGED,
  useStagingStore,
  type StagingSide,
  type SelectMode
} from '@renderer/stores/staging.js';


export interface StagingSelectionOptions {
  side: () => StagingSide;
  pathsUnder: (key: string) => string[];
  isFolderSelected: (key: string, isSelected: (path: string) => boolean) => boolean;
}

export function useStagingSelection(opts: StagingSelectionOptions)
{
  const staging = useStagingStore();

  /**
   * This list's share of the selection, as a set.
   *
   * A set rather than the store's array because every row asks: with a folder of two
   * hundred files picked, `includes` per row is the difference between a list that draws
   * and one that stutters while you shift-drag through it.
   */
  const selectedHere = computed<ReadonlySet<string>>(() =>
  {
    if (staging.side === opts.side())
    {
      return new Set(staging.selectedPaths);
    }
    else
    {
      return new Set();
    }
  }
  );

  const selectedCount = computed(() => selectedHere.value.size);

  const isSelected = (file: DiffFileEntry): boolean => selectedHere.value.has(file.path);

  /** The one row the diff pane is showing, marked apart from the rest of the selection. */
  const isPrimary = (file: DiffFileEntry): boolean =>
    staging.side === opts.side() && staging.selectedPath === file.path;

  function isFolderSelected(key: string): boolean
  {
    return opts.isFolderSelected(key, (path) => selectedHere.value.has(path));
  }

  function onRowClick(file: DiffFileEntry, event: MouseEvent): void
  {
    let mode: SelectMode;
    if (event.shiftKey)
    {
      mode = MODE_RANGE;
    }
    else if (event.metaKey || event.ctrlKey)
    {
      mode = MODE_TOGGLE;
    }
    else
    {
      mode = MODE_REPLACE;
    }
    staging.select(opts.side(), file.path, mode);
  }

  /**
   * Plain click folds; shift/ctrl selects all files inside so a folder becomes an operand for any command.
   */
  function onFolderClick(key: string, event: MouseEvent, toggleFolder: (key: string) => void): void
  {
    if (event.metaKey || event.ctrlKey)
    {
      staging.selectPaths(opts.side(), opts.pathsUnder(key), MODE_TOGGLE);
    }
    else if (event.shiftKey)
    {
      staging.selectPaths(opts.side(), opts.pathsUnder(key), MODE_REPLACE);
    }
    else
    {
      toggleFolder(key);
    }
  }

  /**
   * The row button and the double-click: into the index from the left list, out of it
   * from the right, and on the whole selection when the row clicked is part of it, which
   * is what makes picking five files and double-clicking one of them do the obvious thing.
   */
  async function move(file: DiffFileEntry): Promise<void>
  {
    let selected: FilePath[];
    if (staging.side === opts.side())
    {
      selected = staging.selectedPaths;
    }
    else
    {
      selected = [];
    }
    let toMove: readonly string[];
    if (selected.includes(toFilePath(file.path)))
    {
      toMove = selected;
    }
    else
    {
      toMove = [file.path];
    }
    await movePaths(toMove);
  }

  /**
   * Move all paths under a folder. We list them individually because `git add -- folder/` would include filtered files.
   */
  async function moveFolder(key: string): Promise<void>
  {
    await movePaths(opts.pathsUnder(key));
  }

  async function movePaths(paths: readonly string[]): Promise<void>
  {
    if (paths.length === 0)
    {
      return;
    }
    if (opts.side() === STAGING_SIDE_STAGED)
    {
      await staging.unstageFiles([...paths]);
    }
    else
    {
      await staging.stageFiles([...paths]);
    }
  }

  async function moveAll(): Promise<void>
  {
    if (opts.side() === STAGING_SIDE_STAGED)
    {
      await staging.unstageAll();
    }
    else
    {
      await staging.stageAll();
    }
  }

  /**
   * Arrow keys inside the list.
   *
   * List behaviour, handled here rather than in the registry: the same decision the
   * revision grid made, and for the same reason: `↓` must not become a global hotkey.
   */
  function onListKeydown(event: KeyboardEvent): void
  {
    if (staging.side !== opts.side())
    {
      return;
    }
    switch (event.key)
    {
      case KEY_ARROW_DOWN:
        event.preventDefault();
        // Shift extends the selection from the anchor, the way it does everywhere else a
        // list is multi-select; without it the keyboard could only ever pick one file.
        staging.step(1, event.shiftKey);
        break;
      case KEY_ARROW_UP:
        event.preventDefault();
        staging.step(-1, event.shiftKey);
        break;
      case KEY_ENTER:
      case KEY_SPACE:
      {
        // Enter moves the selection across, which is what the row button and the
        // double-click do: all of them on every picked file, not just the focused one.
        const selected = staging.selectedPaths;
        if (selected.length > 0)
        {
          event.preventDefault();
          void movePaths(selected);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    selectedHere,
    selectedCount,
    isSelected,
    isPrimary,
    isFolderSelected,
    onRowClick,
    onFolderClick,
    move,
    moveFolder,
    moveAll,
    onListKeydown
  };
}
