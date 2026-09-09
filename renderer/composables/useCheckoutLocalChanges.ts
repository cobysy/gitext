/**
 * The local-changes plan a checkout carries. Checking out a branch or a bare revision
 * are different questions about *what* to check out, but a dirty tree in the way faces
 * the identical one: stash, park on a branch, merge, reset, or refuse.
 * `CheckoutBranchDialog` and `CheckoutRevisionDialog` both need this whole cluster identically, so it lives once here rather than as two copies free to drift.
 */

import { computed, ref, watch } from 'vue';
import {
  buildStashPopArgs,
  LOCAL_CHANGES_BRANCH,
  LOCAL_CHANGES_NONE,
  LOCAL_CHANGES_RESET,
  LOCAL_CHANGES_STASH,
  type LocalChanges,
  type LocalChangesBranchMode,
  type LocalChangesChoiceValue
} from '@renderer/model/args/checkout.js';
import { suggestedWipBranchName } from '@renderer/model/localBranchName.js';
import { hasStashableChanges } from '@renderer/model/trackedChanges.js';
import type { DialogController } from '@renderer/composables/useDialog.js';
import { useUiStore } from '@renderer/stores/ui.js';
import type { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import { REF_KIND_BRANCH } from '@shared/types.js';
import { CHECKOUT, CHECKOUT_WITH_STASH, HISTORY_MOVE, type RepoFacet } from '@shared/invalidation.js';

const BRANCH_MODE_COMMIT = 'commit';
const FACET_STASHES = 'stashes';
const FACET_WORKTREE = 'worktree';
const FACET_INDEX = 'index';

export interface CheckoutLocalChangesDeps {
  repo: ReturnType<typeof useRepoStore>;
  objects: ReturnType<typeof useRepoObjectsStore>;
  settings: ReturnType<typeof useSettingsStore>;
}

export function useCheckoutLocalChanges({ repo, objects, settings }: CheckoutLocalChangesDeps)
{
  const ui = useUiStore();

  /** Free: the working-tree status is already loaded for this window and re-read on every watcher tick, unlike ahead/behind. */
  const dirty = computed(() => (repo.status?.files.length ?? 0) > 0);

  const localChanges = ref<LocalChangesChoiceValue>(settings.settings.checkoutLocalChanges);
  const rememberLocalChanges = ref(false);

  /** Which of the three ways to put the changes on a branch, and what to call it. */
  const branchMode = ref<LocalChangesBranchMode>(BRANCH_MODE_COMMIT);
  const wipBranchName = ref(
    suggestedWipBranchName(
      repo.repo?.branch ?? null,
      objects.refs.filter((entry) => entry.kind === REF_KIND_BRANCH).map((entry) => entry.name)
    )
  );

  /**
   * Neither choice can be remembered. Reset: a default of "throw my changes away" is not
   * one anyone should set by accident. Branch: it needs a name, and a remembered one
   * would collide on reuse or quietly become a different branch each time.
   */
  const canRemember = computed(
    () => localChanges.value !== LOCAL_CHANGES_RESET && localChanges.value !== LOCAL_CHANGES_BRANCH
  );

  watch(canRemember, (allowed) =>
  {
    if (!allowed)
    {
      rememberLocalChanges.value = false;
    }
  });

  /**
   * Whether a stash would save anything. `dirty` counts untracked files and a plain
   * `stash push` does not save them, so a tree whose only change is an untracked build
   * directory has nothing to stash: running it anyway is a subprocess that creates no
   * stash, and on a large working tree it is a third of a second of the checkout.
   */
  const stashable = computed(() =>
    hasStashableChanges(repo.status?.files ?? [], settings.settings.autoStashUntracked)
  );

  /** A choice about changes that do not exist is not a choice, and neither is a stash with nothing to save. */
  const effectiveLocalChanges = computed<LocalChangesChoiceValue>(() =>
  {
    if (!dirty.value)
    {
      return LOCAL_CHANGES_NONE;
    }
    if (localChanges.value === LOCAL_CHANGES_STASH && !stashable.value)
    {
      return LOCAL_CHANGES_NONE;
    }
    return localChanges.value;
  });

  /** `stash` and `branch` are commands in front of the checkout, not flags on it. */
  const flagLocalChanges = computed<LocalChanges>(() =>
  {
    if (
      effectiveLocalChanges.value === LOCAL_CHANGES_STASH ||
      effectiveLocalChanges.value === LOCAL_CHANGES_BRANCH
    )
    {
      return LOCAL_CHANGES_NONE;
    }
    else
    {
      return effectiveLocalChanges.value;
    }
  });

  /** The branch plan, or nothing: `buildCheckoutSteps` treats it as the whole plan. */
  const changesBranch = computed(() =>
  {
    if (effectiveLocalChanges.value === LOCAL_CHANGES_BRANCH)
    {
      return {
        mode: branchMode.value,
        name: wipBranchName.value.trim(),
        from: repo.repo?.branch ?? null
      };
    }
    else
    {
      return undefined;
    }
  });

  const willStash = computed(() => effectiveLocalChanges.value === LOCAL_CHANGES_STASH);

  /**
   * What the checkout invalidates, depending on how it deals with local changes. A
   * plain checkout moves HEAD and rewrites the working tree, creating nothing, so under
   * any scope but `current` the grid redraws without re-running its query (see
   * `needsLogReload`). Stashing adds an entry; parking on a branch is a history move.
   */
  const invalidates = computed<readonly RepoFacet[]>(() =>
  {
    if (effectiveLocalChanges.value === LOCAL_CHANGES_BRANCH)
    {
      return [...HISTORY_MOVE, FACET_STASHES];
    }
    if (willStash.value)
    {
      return CHECKOUT_WITH_STASH;
    }
    return CHECKOUT;
  });

  /**
   * Persist the choice, once the checkout it was made for has actually succeeded: a
   * preference from a dialog that failed is not one the user saw the result of. Only the choices that can run unattended; see `canRemember`.
   */
  async function rememberIfWanted(): Promise<void>
  {
    if (rememberLocalChanges.value && canRemember.value)
    {
      await settings.patch({ checkoutLocalChanges: localChanges.value as 'none' | 'merge' | 'stash' });
    }
  }

  /**
   * The other half of a stashed checkout: offer to pop it back once the checkout that
   * stashed it succeeds. A pop that conflicts leaves the stash in place and says so, so its failure keeps the window open rather than a toast behind a closed one.
   */
  async function popStashIfWanted(run: DialogController['run'], close: () => void): Promise<void>
  {
    const reapply = await ui.confirmUnlessSuppressed({
      title: 'Re-apply your changes?',
      message: 'Your changes were stashed. Pop them back on top?',
      confirmLabel: 'Pop the stash',
      rememberKey: 'checkout.reapplyStash'
    });
    if (
      reapply &&
      !(await run(buildStashPopArgs(), [FACET_STASHES, FACET_WORKTREE, FACET_INDEX], { close: false }))
    )
    {
      return;
    }
    close();
  }

  return {
    dirty,
    localChanges,
    rememberLocalChanges,
    branchMode,
    wipBranchName,
    canRemember,
    effectiveLocalChanges,
    flagLocalChanges,
    changesBranch,
    willStash,
    invalidates,
    rememberIfWanted,
    popStashIfWanted
  };
}
