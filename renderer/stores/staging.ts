/**
 * Commit screen state: unstaged (index vs tree) and staged (HEAD vs index) lists.
 * Composition root wiring selection, patch, actions, commit, and history submodules.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { createSelectionState } from './staging/selection.js';
import { createPatchState, lineKey } from './staging/patch.js';
import { createStagingActions } from './staging/actions.js';
import { createCommitState } from './staging/commit.js';
import { createHistoryState } from './staging/history.js';
import type { MultiSelectMode, SelectMode } from '@renderer/pathSelection.js';
import { STAGING_SIDE_STAGED, STAGING_SIDE_UNSTAGED, type StagingSide } from './staging/types.js';

/** Where a push this screen ran and git refused is handed to. */
const DIALOG_REMOTE_PUSH = 'remote.push';

export type { StagingSide };
export { STAGING_SIDE_STAGED, STAGING_SIDE_UNSTAGED };
export type { MultiSelectMode, SelectMode };
export { lineKey };

export const useStagingStore = defineStore('staging', () =>
{
  const repo = useRepoStore();
  const settings = useSettingsStore();

  // One error surface for all submodules.
  const error = ref<string | null>(null);

  const selection = createSelectionState();
  const patch = createPatchState({ repo, settings, selection, error });

  function reset(): void
  {
    selection.reset();
    patch.reset();
    commit.reset();
    history.reset();
    error.value = null;
  }

  const actions = createStagingActions({
    repo,
    settings,
    selection,
    patch,
    error,
    resetForNoRepo: reset
  });
  const commit = createCommitState({
    settings,
    selection,
    repo,
    run: actions.run,
    error,
    failureOutput: actions.failureOutput,
    // Close commit screen then open push dialog (not awaited): same hand-off pattern as conflict resolver.
    onPushFailed: (stderr) =>
    {
      const ui = useUiStore();
      ui.closeCommitScreen();
      ui.openDialog(DIALOG_REMOTE_PUSH, {
        ref: repo.repo?.branch ?? undefined,
        pushRejection: stderr
      });
    },
    readMessageFile: (path, name) => api['git:readMessageFile'](path, name)
  });

  const history = createHistoryState();

  const isEmpty = computed(
    () =>
      !actions.loading.value &&
      selection.unstagedFiles.value.length === 0 &&
      selection.stagedFiles.value.length === 0
  );

  return {
    unstagedFiles: selection.unstagedFiles,
    stagedFiles: selection.stagedFiles,
    loading: actions.loading,
    error,
    side: selection.side,
    picks: selection.picks,
    selectedPath: selection.selectedPath,
    selectedPaths: selection.selectedPaths,
    selectedFile: selection.selectedFile,
    selectedEntries: selection.selectedEntries,
    patchText: patch.patchText,
    patchFile: patch.patchFile,
    patchTarget: patch.patchTarget,
    patchLoading: patch.patchLoading,
    patchTruncated: patch.patchTruncated,
    focusedHunk: patch.focusedHunk,
    resetAuthor: commit.resetAuthor,
    author: commit.author,
    recentMessages: history.recentMessages,
    recentAuthors: history.recentAuthors,
    loadHistory: () => history.load(repo.repo?.path),
    pickedLines: patch.pickedLines,
    pickedLineText: patch.pickedLineText,
    skipWorktree: actions.skipWorktree,
    assumeUnchanged: actions.assumeUnchanged,
    range: selection.range,
    message: commit.message,
    amend: commit.amend,
    committing: commit.committing,
    isEmpty,
    canCommit: commit.canCommit,
    commitArgv: commit.commitArgv,
    select: selection.select,
    selectPaths: selection.selectPaths,
    selectAll: selection.selectAll,
    setOrder: selection.setOrder,
    step: selection.step,
    reset,
    refresh: actions.refresh,
    loadFiles: actions.loadFiles,
    loadPatch: patch.loadPatch,
    loadIndexFlags: actions.loadIndexFlags,
    stageFiles: actions.stageFiles,
    unstageFiles: actions.unstageFiles,
    stageAll: actions.stageAll,
    unstageAll: actions.unstageAll,
    discard: actions.discard,
    applyHunk: actions.applyHunk,
    commit: commit.commit
  };
});
