/**
 * The two lists themselves, and which files in them are picked: which side is selected
 * and the arithmetic of turning a click, a folder, or an arrow key into a new
 * `PathSelection`. Nothing here talks to git: loading the lists is `actions.ts`'s job,
 * which is what makes `select`, `selectAll` and `step` unit-testable with no fake `api`.
 */

import { computed, ref } from 'vue';
import {
  EMPTY_SELECTION,
  MODE_REPLACE,
  pickPath,
  pickPaths,
  stepPath,
  type MultiSelectMode,
  type PathSelection,
  type SelectMode
} from '@renderer/pathSelection.js';
import { toFilePath, toFilePaths, type FilePath } from '@renderer/model/paths.js';
import type { DiffFileEntry, DiffRange } from '@shared/diff.js';
import {
  STAGED_RANGE,
  STAGING_SIDE_STAGED,
  STAGING_SIDE_UNSTAGED,
  UNSTAGED_RANGE,
  type SideState,
  type StagingSide
} from './types.js';

export function createSelectionState()
{
  const unstagedFiles = ref<DiffFileEntry[]>([]);
  const stagedFiles = ref<DiffFileEntry[]>([]);

  /** Which list the selection is in. */
  const side = ref<StagingSide>(STAGING_SIDE_UNSTAGED);

  const unstagedSelection = ref<PathSelection<FilePath>>(EMPTY_SELECTION);
  const stagedSelection = ref<PathSelection<FilePath>>(EMPTY_SELECTION);
  const unstagedOrder = ref<FilePath[]>([]);
  const stagedOrder = ref<FilePath[]>([]);

  /** The one table every "which side" question is answered from. */
  const sides: Record<StagingSide, SideState> = {
    [STAGING_SIDE_UNSTAGED]: {
      files: unstagedFiles,
      selection: unstagedSelection,
      order: unstagedOrder,
      range: UNSTAGED_RANGE
    },
    [STAGING_SIDE_STAGED]: {
      files: stagedFiles,
      selection: stagedSelection,
      order: stagedOrder,
      range: STAGED_RANGE
    }
  };

  const files = computed(() => sides[side.value].files.value);

  const picks = computed(() => sides[side.value].selection.value.picks);

  /** The pivot the selected side is showing, which is what an external tool is handed. */
  const range = computed<DiffRange>(() => sides[side.value].range);

  /** The picked paths still in the list. Filtered on read, not pruned on write: the lists reload on every `.git` change. */
  const selectedPaths = computed<FilePath[]>(() =>
  {
    const present = new Set(files.value.map((file) => file.path));
    return picks.value.filter((path) => present.has(path));
  });

  /**
   * The one file the diff pane shows: the last pick, or the first row when nothing is
   * picked, so opening the screen shows a diff rather than an empty pane.
   */
  const selectedPath = computed<FilePath | null>(() =>
  {
    const list = selectedPaths.value;
    if (list.length > 0)
    {
      return list[list.length - 1]!;
    }
    const first = files.value[0]?.path;
    if (first === undefined)
    {
      return null;
    }
    else
    {
      return toFilePath(first);
    }
  });

  const selectedFile = computed<DiffFileEntry | null>(
    () => files.value.find((file) => file.path === selectedPath.value) ?? null
  );

  /** The entries behind `selectedPaths`, which is what the file commands act on. */
  const selectedEntries = computed<DiffFileEntry[]>(() =>
  {
    const wanted = new Set(selectedPaths.value);
    return files.value.filter((file) => wanted.has(toFilePath(file.path)));
  });

  /** The rows one list is drawing, or its files when nothing has drawn them yet. */
  function drawnPaths(which: StagingSide): FilePath[]
  {
    const drawn = sides[which].order.value;
    if (drawn.length > 0)
    {
      return drawn;
    }
    return sides[which].files.value.map((file) => toFilePath(file.path));
  }

  /**
   * The list component reporting what it drew, after a filter, a fold or a reshape.
   * `paths` arrives as plain `string` and is branded here, the one place a path from outside becomes this store's domain type.
   */
  function setOrder(which: StagingSide, paths: readonly string[]): void
  {
    sides[which].order.value = toFilePaths(paths);
  }

  function select(which: StagingSide, path: string | null, mode: SelectMode = MODE_REPLACE): void
  {
    side.value = which;
    const target = sides[which].selection;
    if (path === null)
    {
      target.value = EMPTY_SELECTION;
    }
    else
    {
      target.value = pickPath(target.value, toFilePath(path), mode, drawnPaths(which));
    }
  }

  /** Pick a whole folder, group, or any other set of paths at once, so "stage this folder" is just an ordinary multi-file stage with that selection. */
  function selectPaths(
    which: StagingSide,
    paths: readonly string[],
    mode: MultiSelectMode = MODE_REPLACE
  ): void
  {
    side.value = which;
    const target = sides[which].selection;
    target.value = pickPaths(target.value, toFilePaths(paths), mode);
  }

  /** Every file the list is *showing* for a select-all: with a filter active, this must not include files off screen. */
  function selectAll(which: StagingSide): void
  {
    selectPaths(which, drawnPaths(which));
  }

  /** Move the selection one row up or down, along the rows on screen. `extend` is the shift-arrow: grows the range from the anchor rather than replacing it. */
  function step(delta: number, extend = false): void
  {
    const target = sides[side.value].selection;
    target.value = stepPath(target.value, selectedPath.value, delta, drawnPaths(side.value), extend);
  }

  /**
   * Keep the pane on the file that was just acted on, even when it changed sides.
   * Staging its last hunk empties it out of the unstaged list; without this the pick
   * fails `selectedPaths`' filter and the pane jumps to `files[0]` instead of following
   * the file to the side it's now wholly on.
   */
  function followAcrossSides(path: FilePath, from: StagingSide): void
  {
    const holds = (which: StagingSide): boolean =>
      sides[which].files.value.some((file) => file.path === path);
    if (holds(from))
    {
      return;
    }

    let other: StagingSide;
    if (from === STAGING_SIDE_STAGED)
    {
      other = STAGING_SIDE_UNSTAGED;
    }
    else
    {
      other = STAGING_SIDE_STAGED;
    }
    if (holds(other))
    {
      select(other, path);
    }
  }

  function reset(): void
  {
    unstagedFiles.value = [];
    stagedFiles.value = [];
    unstagedSelection.value = EMPTY_SELECTION;
    stagedSelection.value = EMPTY_SELECTION;
    unstagedOrder.value = [];
    stagedOrder.value = [];
  }

  return {
    unstagedFiles,
    stagedFiles,
    side,
    sides,
    files,
    picks,
    range,
    selectedPaths,
    selectedPath,
    selectedFile,
    selectedEntries,
    drawnPaths,
    setOrder,
    select,
    selectPaths,
    selectAll,
    step,
    followAcrossSides,
    reset
  };
}

export type SelectionState = ReturnType<typeof createSelectionState>;

export type { StagingSide };
