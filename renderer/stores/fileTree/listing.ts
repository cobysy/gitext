/**
 * Tree listing for current endpoint: owns when to read (guarded by newestOnly).
 * Prevents fast grid walking from racing git answers.
 */

import { computed, ref } from 'vue';
import type { DiffEndpoint } from '@shared/diff.js';
import { api, toMessage } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { SelectionState } from './selection.js';

export interface ListingDeps {
  repo: ReturnType<typeof useRepoStore>;
  endpoint: () => DiffEndpoint | null;
  /** The key that says which listing is loaded: see the store's own `endpointKey`. */
  endpointKey: () => string;
  selection: SelectionState;
  /** Everything else's `reset()`, for the "no repository open" branch of `load`. */
  resetForNoRepo: () => void;
}

export function createListingState({ repo, endpoint, endpointKey, selection, resetForNoRepo }: ListingDeps)
{
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Which listing `selection.collapsedFolders` has been seeded for. */
  let collapsedFor: string | null = null;

  /** Which endpoint `selection.entries` holds an answer for: see `diff/files.ts`. */
  const loadedKey = ref('');

  const isEmpty = computed(
    () => !loading.value && error.value === null && selection.entries.value.length === 0
  );

  const request = newestOnly();

  async function load(): Promise<void>
  {
    const isNewest = request.begin();
    const repoPath = repo.repo?.path;
    const current = endpoint();

    if (!repoPath || !current)
    {
      resetForNoRepo();
      return;
    }

    loading.value = true;
    error.value = null;

    try
    {
      const result = await api['tree:list'](repoPath, current);
      if (!isNewest())
      {
        return;
      }

      selection.entries.value = result;
      loadedKey.value = endpointKey();

      // Collapse everything the first time a given listing arrives, and only then: a
      // reload from the `.git` watcher must not close the folders you just opened.
      if (collapsedFor !== endpointKey())
      {
        collapsedFor = endpointKey();
        selection.collapseAll();
      }
    }
    catch (err)
    {
      if (!isNewest())
      {
        return;
      }
      // Worth showing rather than leaving an empty pane: an empty tree and a failed read
      // look identical, and only one of them is a repository state.
      error.value = toMessage(err);
      selection.entries.value = [];
      loadedKey.value = endpointKey();
    }
    finally
    {
      if (isNewest())
      {
        loading.value = false;
      }
    }
  }

  function reset(): void
  {
    loading.value = false;
    error.value = null;
    collapsedFor = null;
    loadedKey.value = '';
  }

  return { loading, error, loadedKey, isEmpty, load, reset };
}

export type ListingState = ReturnType<typeof createListingState>;
