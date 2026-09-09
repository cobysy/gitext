/**
 * Which branches are contained in selected commit. Recomputed on selection move (debounced).
 */

import { ref } from 'vue';
import type { RefEntry } from '@shared/types.js';
import { api } from '@renderer/api.js';
import { markMerged } from '@renderer/panel.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import { HEAD_REF } from '@renderer/model/sha.js';

/** Longer than a key repeat, so holding ↓ in the grid costs one call, not forty. */
const MERGED_DEBOUNCE_MS = 250;


export interface MergedDeps {
  repo: ReturnType<typeof useRepoStore>;
  /** The refs to mark against: read fresh on each call, never captured. */
  refs: () => readonly RefEntry[];
}

export function createMergedState({ repo, refs }: MergedDeps)
{
  /**
   * Refs already contained in the commit the grid has selected.
   *
   * One `for-each-ref --merged` is a single revision walk: about 70 ms across 17k
   * commits, which is why it can follow a selection at all.
   */
  const mergedRefs = ref<ReadonlySet<string>>(new Set());
  /** The commit `mergedRefs` was computed for, so an unchanged selection costs nothing. */
  let mergedFor: string | null = null;
  /**
   * The call currently out, and the commit it asks about. `mergedFor` is only set on
   * arrival, so without this a second ask for the same commit while the first is still
   * walking starts a second walk of the same history: two of the most expensive read
   * this panel makes. Held as an object so only the call's *own* completion clears it,
   * and one superseded by `invalidate` cannot clear its replacement's.
   */
  let inFlight: { readonly commit: string } | null = null;
  let mergedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Recompute which branches are contained in `sha`.
   *
   * `null`: no selection, or a working-tree row whose sentinel SHA git would reject:
   * asks about HEAD instead.
   */
  function loadMerged(sha: string | null): void
  {
    const repoPath = repo.repo?.path;
    if (!repoPath)
    {
      return;
    }

    const commit = sha ?? HEAD_REF;
    if (commit === mergedFor || commit === inFlight?.commit)
    {
      return;
    }

    // Which refs to leave unmarked: the ones pointing at the commit being asked about.
    // With no selection that commit is HEAD, and `RepoInfo.head` is the full SHA the
    // refs are compared against: without it the checked-out branch marks itself as
    // contained in itself, which is true and says nothing.
    const atSha = sha ?? repo.repo?.head ?? null;

    if (mergedTimer)
    {
      clearTimeout(mergedTimer);
    }
    mergedTimer = setTimeout(() =>
    {
      mergedTimer = null;
      const call = { commit };
      inFlight = call;
      void api['refs:merged'](repoPath, commit)
        .then((merged) =>
        {
          // A reload may have landed while this was in flight; the newest wins.
          mergedFor = commit;
          mergedRefs.value = markMerged(merged, refs(), atSha);
        })
        .catch(() =>
        {
          // Nothing is marked, which is the honest answer when the question failed.
          mergedRefs.value = new Set();
        })
        .finally(() =>
        {
          if (inFlight === call)
          {
            inFlight = null;
          }
        });
    }, MERGED_DEBOUNCE_MS);
  }

  /** The ref list moved under an unchanged selection: a ref may have moved. */
  function invalidate(): void
  {
    mergedFor = null;
    inFlight = null;
  }

  function reset(): void
  {
    if (mergedTimer)
    {
      clearTimeout(mergedTimer);
    }
    mergedTimer = null;
    mergedFor = null;
    inFlight = null;
    mergedRefs.value = new Set();
  }

  return { mergedRefs, loadMerged, invalidate, reset };
}
