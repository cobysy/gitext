/**
 * Diff pivot, file list, and patch (one store: they chain together).
 * Selection determines range, range determines files, files determine patch.
 * than git can answer, and without the guard the pane settles on whichever response
 * happened to arrive last rather than on the row that is selected.
 */

import { defineStore } from 'pinia';
import { watch } from 'vue';
import { useFilePaneStore } from '@renderer/stores/filePane.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { createPivotState } from './diff/pivot.js';
import { createSelectionState } from './diff/selection.js';
import { createFilesState } from './diff/files.js';
import { createPatchState } from './diff/patch.js';

export const useDiffStore = defineStore('diff', () =>
{
  const pane = useFilePaneStore();
  const repo = useRepoStore();
  const revisions = useRevisionsStore();
  const gridSelection = useSelectionStore();
  const settings = useSettingsStore();

  const pivot = createPivotState({ repo, revisions, gridSelection, settings });
  const selection = createSelectionState({ pane, settings });

  /** Everything else's state, for the "no repository open" branch of `loadFiles`. */
  function reset(): void
  {
    selection.reset();
    files.reset();
    patch.reset();
  }

  const files = createFilesState({ repo, pivot, selection, resetForNoRepo: reset });
  const patch = createPatchState({ repo, pivot, selection, settings });

  watch(pivot.requestKey, () => void files.loadFiles(), { immediate: true });

  // The patch follows the file, and the list it came from, which carries the range and the
  // options with it, so changing the context lines still re-asks git rather than redrawing
  // what is already here, but only once the list for those options has landed.
  watch([() => selection.selectedFile.value?.path, files.loadedKey], () => void patch.loadPatch(), {
    immediate: true
  });

  /**
   * Re-read both, without the pivot having changed.
   *
   * What the `.git` watcher calls: staging a file moves it from one artificial row's
   * list to the other's and editing one changes the patch under it, but the range is
   * still "the index against the working tree", so nothing the watchers above look at
   * has moved.
   */
  async function refresh(): Promise<void>
  {
    await files.loadFiles();
    await patch.loadPatch();
  }

  return {
    files: selection.files,
    collapsedFolders: selection.collapsedFolders,
    filesLoading: files.filesLoading,
    filesError: files.filesError,
    loadedKey: files.loadedKey,
    selectedPath: selection.selectedPath,
    selectedPaths: selection.selectedPaths,
    selectedFile: selection.selectedFile,
    selectedEntries: selection.selectedEntries,
    patch: patch.patch,
    patchLoading: patch.patchLoading,
    patchError: patch.patchError,
    parsedFile: patch.parsedFile,
    aligned: patch.aligned,
    focusedBlock: patch.focusedBlock,
    range: pivot.range,
    rangeKey: pivot.rangeKey,
    setRange: pivot.setRange,
    options: pivot.options,
    isEmpty: files.isEmpty,
    select: selection.select,
    selectPaths: selection.selectPaths,
    setOrder: selection.setOrder,
    stepDifference: patch.stepDifference,
    focusBlock: patch.focusBlock,
    toggleFolder: selection.toggleFolder,
    expandAll: selection.expandAll,
    collapseAll: selection.collapseAll,
    reset,
    refresh,
    loadFiles: files.loadFiles,
    loadPatch: patch.loadPatch
  };
});
