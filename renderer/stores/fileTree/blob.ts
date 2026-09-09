/**
 * Reading the contents of the file the tree has selected.
 *
 * One responsibility: the round trip for the followed file's body, guarded by
 * `newestOnly` for the same reason `listing.ts`'s read is. Mirrors `stores/diff/patch.ts`.
 */

import { ref } from 'vue';
import type { DiffEndpoint } from '@shared/diff.js';
import type { BlobContents, TreeEntry } from '@shared/tree.js';
import { api, toMessage } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import type { useRepoStore } from '@renderer/stores/repo.js';

export interface BlobDeps {
  repo: ReturnType<typeof useRepoStore>;
  endpoint: () => DiffEndpoint | null;
  /** File to read: entry not SelectionState (multiple lists can ask; composition root decides). */
  entry: () => TreeEntry | null;
}

interface BlobTarget {
  repoPath: string;
  current: DiffEndpoint;
  entry: TreeEntry;
}

/** The repo/endpoint/entry to read a blob from, or null when any is missing. */
function blobTargetOf(
  repoPath: string | undefined,
  current: DiffEndpoint | null,
  entry: TreeEntry | null
): BlobTarget | null
{
  if (repoPath && current && entry)
  {
    return { repoPath, current, entry };
  }
  else
  {
    return null;
  }
}

export function createBlobState({ repo, endpoint, entry: entryOf }: BlobDeps)
{
  const blob = ref<BlobContents | null>(null);
  const blobLoading = ref(false);
  const blobError = ref<string | null>(null);

  const request = newestOnly();

  async function loadBlob(): Promise<void>
  {
    const isNewest = request.begin();
    const target = blobTargetOf(repo.repo?.path, endpoint(), entryOf());

    blobError.value = null;
    if (!target)
    {
      blob.value = null;
      blobLoading.value = false;
      return;
    }

    blobLoading.value = true;
    try
    {
      const result = await api['tree:blob'](target.repoPath, target.current, target.entry);
      if (isNewest())
      {
        blob.value = result;
      }
    }
    catch (err)
    {
      if (isNewest())
      {
        blobError.value = toMessage(err);
        blob.value = null;
      }
    }
    finally
    {
      if (isNewest())
      {
        blobLoading.value = false;
      }
    }
  }

  function reset(): void
  {
    blob.value = null;
    blobError.value = null;
    blobLoading.value = false;
  }

  return { blob, blobLoading, blobError, loadBlob, reset };
}

export type BlobState = ReturnType<typeof createBlobState>;
