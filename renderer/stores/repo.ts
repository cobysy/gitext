/**
 * Current repository: identity, in-progress operation, working-tree status.
 * Separate from revisions/repoObjects so checkout touching only HEAD doesn't reload them.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { OPERATION_NONE, type RepoInfo, type RepoState, type WorkingTreeStatus } from '@shared/types.js';
import { api, toMessage } from '@renderer/api.js';
import { useSettingsStore } from './settings.js';

export const useRepoStore = defineStore('repo', () =>
{
  const repo = ref<RepoInfo | null>(null);
  const state = ref<RepoState>({ operation: OPERATION_NONE, conflictCount: 0, conflictedPaths: [] });
  const status = ref<WorkingTreeStatus | null>(null);
  const loading = ref(false);
  const error = ref('');

  const isOpen = computed(() => repo.value !== null);
  // True when git is mid-operation (drives banner).
  const isMidOperation = computed(() => state.value.operation !== OPERATION_NONE);
  const changedFileCount = computed(() => status.value?.files.length ?? 0);

  async function open(path?: string): Promise<boolean>
  {
    loading.value = true;
    error.value = '';
    try
    {
      let info;
      if (path)
      {
        info = await api['repo:open'](path);
      }
      else
      {
        info = await api['repo:pick']();
      }
      if (!info)
      {
        if (path)
        {
          error.value = `${path} is not a git repository.`;
        }
        return false;
      }

      if (repo.value)
      {
        await api['repo:unwatch'](repo.value.path);
      }
      repo.value = info;
      // Cleared with the repository it described, not left standing until `refresh` below
      // replaces it. `state` is a fact about `repo`, and for the moment in between it would
      // be the *previous* repository's, which is wrong on its own terms, and is what makes
      // a count of three conflicts followed by a count of one read as a change rather than
      // as arriving somewhere with conflicts in it. `useAfterGitOperation` watches for
      // exactly that transition.
      state.value = { operation: OPERATION_NONE, conflictCount: 0, conflictedPaths: [] };
      status.value = null;
      await api['repo:watch'](info.path);
      await refresh();

      // The main process already recorded this; mirror it so the UI updates now.
      await useSettingsStore().load();
      return true;
    }
    catch (err)
    {
      error.value = toMessage(err);
      return false;
    }
    finally
    {
      loading.value = false;
    }
  }

  /**
   * Point this store at a repository someone else already opened.
   *
   * What a dialog window does on mount. It is `open` without the two things that belong
   * to the window that owns the repository: it does not record a recent repository, and
   * it does not start a watcher: the repository window is already watching, and a
   * dialog closing would otherwise call `unwatch` and take the main window's watcher
   * with it. Changes still arrive: `event:repoChanged` is broadcast to every window.
   */
  async function adopt(path: string): Promise<void>
  {
    loading.value = true;
    error.value = '';
    try
    {
      repo.value = await api['repo:info'](path);
      await refresh();
    }
    catch (err)
    {
      error.value = toMessage(err);
    }
    finally
    {
      loading.value = false;
    }
  }

  async function close(): Promise<void>
  {
    if (!repo.value)
    {
      return;
    }
    await api['repo:unwatch'](repo.value.path);
    repo.value = null;
    status.value = null;
    state.value = { operation: OPERATION_NONE, conflictCount: 0, conflictedPaths: [] };
  }

  /** Re-read identity, in-progress state, and working-tree status together. */
  async function refresh(): Promise<void>
  {
    const current = repo.value;
    if (!current)
    {
      return;
    }
    try
    {
      const [info, nextState, nextStatus] = await Promise.all([
        api['repo:info'](current.path),
        api['repo:state'](current.path),
        api['repo:status'](current.path)
      ]);
      if (info)
      {
        repo.value = info;
      }
      state.value = nextState;
      status.value = nextStatus;
    }
    catch (err)
    {
      error.value = toMessage(err);
    }
  }

  return {
    repo,
    state,
    status,
    loading,
    error,
    isOpen,
    isMidOperation,
    changedFileCount,
    open,
    adopt,
    close,
    refresh
  };
});
