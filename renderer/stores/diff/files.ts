/**
 * Read changed-file list for current pivot. Timing guarded by newestOnly:
 * arrow key walks grid faster than git, settles on selected row.
 */

import { computed, ref } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { PivotState } from './pivot.js';
import type { SelectionState } from './selection.js';

export interface FilesDeps {
  repo: ReturnType<typeof useRepoStore>;
  pivot: PivotState;
  selection: SelectionState;
  /** Reset callback for no-repo branch. */
  resetForNoRepo: () => void;
}

export function createFilesState({ repo, pivot, selection, resetForNoRepo }: FilesDeps)
{
  const filesLoading = ref(false);
  const filesError = ref<string | null>(null);

  /**
   * What `selection.files` currently holds an answer for: repository, range, and options.
   *
   * The patch waits on this rather than on the range itself. A range change reaches both
   * loaders in the same tick, and the file list is the slower of the two, so the patch
   * would be fetched for whichever file the *previous* range had open: a file the new
   * commit's list need not even contain. That answer often arrives first, and its content
   * is drawn until the real one replaces it: the flash of a file from nowhere.
   */
  const loadedKey = ref('');

  const isEmpty = computed(
    () => !filesLoading.value && filesError.value === null && selection.files.value.length === 0
  );

  const filesRequest = newestOnly();

  async function loadFiles(): Promise<void>
  {
    const isNewest = filesRequest.begin();
    const repoPath = repo.repo?.path;
    const current = pivot.range.value;
    const key = pivot.requestKey.value;

    if (!repoPath || !current)
    {
      resetForNoRepo();
      return;
    }

    filesLoading.value = true;
    filesError.value = null;

    try
    {
      const result = await api['diff:files'](repoPath, current, pivot.options.value);
      if (!isNewest())
      {
        return;
      }

      // Which file is open follows from this and from the wanted path; nothing here
      // assigns a selection.
      selection.files.value = result;
      loadedKey.value = key;
    }
    catch (err)
    {
      if (!isNewest())
      {
        return;
      }
      // A failure here is worth showing: it means the range named something git could
      // not resolve, which is a bug in the pivot rather than a repository state.
      filesError.value = toMessage(err);
      selection.files.value = [];
      loadedKey.value = key;
    }
    finally
    {
      if (isNewest())
      {
        filesLoading.value = false;
      }
    }
  }

  function reset(): void
  {
    filesLoading.value = false;
    filesError.value = null;
    loadedKey.value = '';
  }

  return { filesLoading, filesError, loadedKey, isEmpty, loadFiles, reset };
}

export type FilesState = ReturnType<typeof createFilesState>;
