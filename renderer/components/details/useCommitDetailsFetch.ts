/**
 * Fetch extras for selected commit: git note. Pulled out:
 * independent reason to change.
 */

import { ref, watch } from 'vue';
import type { CommitDetails } from '@shared/types.js';
import { isArtificialSha } from '@shared/artificial.js';
import { api, toMessage } from '@renderer/api.js';

export interface CommitDetailsFetchOptions {
  sha: () => string | null;
  repoPath: () => string | undefined;
}

export function useCommitDetailsFetch(opts: CommitDetailsFetchOptions)
{
  /** The fetched extras, or null while there is nothing selected or nothing back yet. */
  const details = ref<CommitDetails | null>(null);
  const error = ref<string | null>(null);

  /**
   * Guards against an out-of-order response.
   *
   * Holding an arrow key walks the grid faster than git can answer, and without this the
   * pane would settle on whichever request happened to finish last rather than on the
   * commit that is actually selected.
   */
  let latestRequest = 0;

  watch(
    [opts.sha, opts.repoPath],
    async ([sha, repoPath]) =>
    {
      const request = ++latestRequest;
      details.value = null;
      error.value = null;
      if (!sha || !repoPath)
      {
        return;
      }

      // The artificial rows' SHAs are sentinels, not objects. Handing one to git would
      // fail, `git show 1111…` finds nothing, and the pane would show that failure as
      // if something were wrong, when the row simply has no note to fetch.
      if (isArtificialSha(sha))
      {
        return;
      }

      try
      {
        const result = await api['revisions:details'](repoPath, sha);
        if (latestRequest === request)
        {
          details.value = result;
        }
      }
      catch (err)
      {
        // Worth showing rather than swallowing: an unreadable note is exactly the kind
        // of thing a silent catch would hide for weeks.
        if (latestRequest === request)
        {
          error.value = toMessage(err);
        }
      }
    },
    { immediate: true }
  );

  return { details, error };
}
