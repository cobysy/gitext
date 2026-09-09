/**
 * Checkout: skips dialog for local branch + clean tree + no settings override.
 * Separate module because two surfaces invoke it (left panel and revision grid branches).
 */

import {
  buildCheckoutSteps,
  LOCAL_CHANGES_NONE,
  LOCAL_CHANGES_STASH
} from '@renderer/model/args/checkout.js';
import type { Settings } from '@shared/types/settings.js';
import type { FileStatus } from '@shared/types.js';
import { CHECKOUT, CHECKOUT_WITH_STASH, type RepoFacet } from '@shared/invalidation.js';
import { hasStashableChanges } from '@renderer/model/trackedChanges.js';
import { useAfterGitOperation } from '@renderer/composables/useAfterGitOperation.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { toMessage } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';

export const KIND_BRANCH = 'branch';
export const KIND_REMOTE_BRANCH = 'remoteBranch';
export const KIND_TAG = 'tag';

/** What is being checked out. A tag and a remote branch each ask something a branch does not. */
export type CheckoutRefKind = typeof KIND_BRANCH | typeof KIND_REMOTE_BRANCH | typeof KIND_TAG;

/**
 * Whether the remembered answer for local changes is one there is anything to do.
 *
 * `dirty` counts untracked files, which a plain `stash push` does not save: an untracked
 * build directory otherwise bought a `stash push` per checkout that created no stash and
 * cost a third of a second on a large working tree. The other answers act on the
 * checkout itself and are always worth passing on.
 */
function worthDoing(
  choice: Settings['checkoutLocalChanges'],
  files: readonly FileStatus[],
  settings: Settings
): boolean
{
  if (choice !== LOCAL_CHANGES_STASH)
  {
    return true;
  }
  return hasStashableChanges(files, settings.autoStashUntracked);
}

export async function checkoutRef(ref: string, kind: CheckoutRefKind): Promise<void>
{
  if (!ref)
  {
    return;
  }

  const repo = useRepoStore();
  const ui = useUiStore();

  // Checking out a tag detaches HEAD; use different dialog.
  if (kind === KIND_TAG)
  {
    ui.openDialog('commit.checkout', { ref });
    return;
  }

  const settings = useSettingsStore().settings;
  const dirty = (repo.status?.files.length ?? 0) > 0;
  // Dirty tree is a question unless the setting provides an answer.
  const answered = !dirty || settings.checkoutUseDefaultLocalChanges;

  const nothingToAsk = kind === KIND_BRANCH && answered && !settings.checkoutAlwaysShowDialog;

  if (!nothingToAsk)
  {
    ui.openDialog('branch.checkout', { ref });
    return;
  }

  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  // Use remembered choice only when dirty; clean trees make every choice a no-op.
  let choice: Settings['checkoutLocalChanges'];
  if (dirty && worthDoing(settings.checkoutLocalChanges, repo.status?.files ?? [], settings))
  {
    choice = settings.checkoutLocalChanges;
  }
  else
  {
    choice = LOCAL_CHANGES_NONE;
  }
  let localChanges: Exclude<Settings['checkoutLocalChanges'], 'stash'>;
  if (choice === LOCAL_CHANGES_STASH)
  {
    localChanges = LOCAL_CHANGES_NONE;
  }
  else
  {
    localChanges = choice;
  }
  const steps = buildCheckoutSteps({
    ref,
    localChanges,
    stash: choice === LOCAL_CHANGES_STASH,
    stashUntracked: settings.autoStashUntracked
  });

  // Stashing adds a facet; otherwise checkout alone doesn't create refs.
  let invalidates: readonly RepoFacet[];
  if (choice === LOCAL_CHANGES_STASH)
  {
    invalidates = CHECKOUT_WITH_STASH;
  }
  else
  {
    invalidates = CHECKOUT;
  }

  try
  {
    await runConsoleSteps(path, steps, invalidates);
    await useAfterGitOperation().afterGitOperation();
    // Explicit feedback: silent stashing looks like lost work.
    if (choice === LOCAL_CHANGES_STASH)
    {
      ui.toast('Your changes were stashed. Stashes ▸ pop.', 'info');
    }
  }
  catch (e)
  {
    // Open dialog on error: it has local-changes options for recovery.
    ui.toast(toMessage(e), 'error');
    ui.openDialog('branch.checkout', { ref });
  }
}
