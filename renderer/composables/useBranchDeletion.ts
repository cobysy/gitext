/**
 * Deleting a set of local branches with one `git branch --delete`: which of them git
 * would refuse, the flag that overrides it, and the argv both of those decide.
 *
 * `-d` refuses an unmerged branch, so the form says which ones are and keeps its button
 * disabled until `--force` is ticked: offering a command the preview shows and git will
 * reject is the preview promising something it will not deliver. "Merged" is read
 * against `HEAD`, re-read whenever the ref list moves, since a checkout in another window
 * changes the answer for every branch.
 */

import { computed, onMounted, ref, watch, type Ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildDeleteBranchArgs } from '@renderer/model/args/branch.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import type { RefEntry } from '@shared/types.js';

export function useBranchDeletion(selected: Readonly<Ref<readonly RefEntry[]>>)
{
  const repo = useRepoStore();
  const objects = useRepoObjectsStore();

  const force = ref(false);

  /** Full ref names already in `HEAD`. */
  const mergedIntoHead = ref<ReadonlySet<string>>(new Set());

  const unmerged = computed(() =>
    selected.value.filter((entry) => !mergedIntoHead.value.has(entry.fullName))
  );

  const argv = computed(() =>
    buildDeleteBranchArgs(
      selected.value.map((entry) => entry.name),
      force.value
    )
  );

  const wouldBeRefused = computed(() => unmerged.value.length > 0 && !force.value);

  /**
   * What the primary promises. A bare count reads as a stray digit when it is `1`: the
   * number is worth saying once there is a number to say, and what it counts with it.
   */
  const deleteLabel = computed(() =>
  {
    if (selected.value.length > 1)
    {
      return `Delete ${selected.value.length} Branches`;
    }
    return 'Delete Branch';
  });

  function isMerged(entry: RefEntry): boolean
  {
    return mergedIntoHead.value.has(entry.fullName);
  }

  async function loadMerged(): Promise<void>
  {
    const path = repo.repo?.path;
    if (!path)
    {
      return;
    }
    try
    {
      mergedIntoHead.value = new Set(await api['refs:merged'](path, 'HEAD'));
    }
    catch
    {
      // Nothing merged is the answer that errs towards the warning rather than past it.
      mergedIntoHead.value = new Set();
    }
  }

  onMounted(loadMerged);
  watch(() => objects.refs, loadMerged);

  return { force, unmerged, argv, wouldBeRefused, deleteLabel, isMerged };
}
