/**
 * Blaming the file the pane is on.
 *
 * One responsibility: the round trip for `git blame`, guarded by `newestOnly` for the
 * same reason `blob.ts`'s read is. Shaped like that one, and gated by the caller in the
 * same way: a blame is a subprocess per file, so nothing asks for one unless the pane
 * is showing it.
 */

import { ref } from 'vue';
import type { DiffEndpoint } from '@shared/diff.js';
import type { BlameFile } from '@shared/types.js';
import { api, toMessage } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import type { useRepoStore } from '@renderer/stores/repo.js';

export interface BlameDeps {
  repo: ReturnType<typeof useRepoStore>;
  endpoint: () => DiffEndpoint | null;
  /** The path to blame, from whichever list the pane is beside. */
  path: () => string | null;
}

export function createBlameState({ repo, endpoint, path: pathOf }: BlameDeps)
{
  const blame = ref<BlameFile | null>(null);
  const blameLoading = ref(false);
  const blameError = ref<string | null>(null);

  const request = newestOnly();

  async function loadBlame(): Promise<void>
  {
    const isNewest = request.begin();
    const repoPath = repo.repo?.path;
    const path = pathOf();

    blameError.value = null;
    if (!repoPath || !path)
    {
      blame.value = null;
      blameLoading.value = false;
      return;
    }

    blameLoading.value = true;
    try
    {
      const result = await api['file:blame'](repoPath, endpoint(), path);
      if (isNewest())
      {
        blame.value = result;
      }
    }
    catch (err)
    {
      if (isNewest())
      {
        blameError.value = toMessage(err);
        blame.value = null;
      }
    }
    finally
    {
      if (isNewest())
      {
        blameLoading.value = false;
      }
    }
  }

  function reset(): void
  {
    blame.value = null;
    blameError.value = null;
    blameLoading.value = false;
  }

  return { blame, blameLoading, blameError, loadBlame, reset };
}

export type BlameState = ReturnType<typeof createBlameState>;
