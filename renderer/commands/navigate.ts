/**
 * Navigate menu: moving the selection through history.
 * Most walk loaded commits; `goToCommit` resolves arbitrary revisions and opens a dialog.
 */

import { defineCommand, hasRepo } from './registry.js';
import { useRevealCommit } from '@renderer/composables/useRevealCommit.js';
import { useNavigationStore } from '@renderer/stores/navigation.js';
import { useQuickSearchStore } from '@renderer/stores/quickSearch.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useUiStore } from '@renderer/stores/ui.js';


/**
 * Select `sha`, or explain why not. `missing` is for commits that don't exist at all (e.g. HEAD with no parent).
 */
function goTo(sha: string | null | undefined, missing: string): void
{
  useRevealCommit().reveal(sha, { missing });
}

export function registerNavigateCommands(): void
{
  // Bound to visual direction (Down/Up) not Ctrl+P/N; Ctrl+P opens the palette here.
  defineCommand({
    id: 'navigate.goToParent',
    label: 'Go to Parent',
    group: 'Navigate',
    keys: ['Mod+Down'],
    when: hasRepo,
    run: () =>
    {
      const revisions = useRevisionsStore();
      const { primary } = useSelectionStore();
      if (!primary)
      {
        return;
      }
      // First parent: on a merge, the branch being merged into (the line down the graph).
      goTo(revisions.commitOf(primary)?.parents[0], 'This commit has no parent in the loaded history.');
    }
  });

  defineCommand({
    id: 'navigate.goToChild',
    label: 'Go to Child',
    group: 'Navigate',
    keys: ['Mod+Up'],
    when: hasRepo,
    run: () =>
    {
      const revisions = useRevisionsStore();
      const { primary } = useSelectionStore();
      if (!primary)
      {
        return;
      }
      goTo(revisions.childrenOf(primary)[0], 'Nothing in the loaded history has this commit as a parent.');
    }
  });

  defineCommand({
    id: 'navigate.goToHead',
    label: 'Go to Current Revision',
    group: 'Navigate',
    keys: ['Mod+Shift+C'],
    when: hasRepo,
    run: () => goTo(useRepoStore().repo?.head, 'HEAD is not in the loaded history.')
  });

  // Alt+Left / Alt+Right, as in every browser.
  defineCommand({
    id: 'navigate.back',
    label: 'Navigate Backward',
    group: 'Navigate',
    keys: ['Alt+Left'],
    when: hasRepo,
    run: () => goTo(useNavigationStore().back(), 'Nothing to go back to.')
  });

  defineCommand({
    id: 'navigate.forward',
    label: 'Navigate Forward',
    group: 'Navigate',
    keys: ['Alt+Right'],
    when: hasRepo,
    run: () => goTo(useNavigationStore().forward(), 'Nothing to go forward to.')
  });

  /**
   * The only one here that opens a dialog: it resolves arbitrary revisions like `v1.2.0^2` against git.
   */
  defineCommand({
    id: 'navigate.goToCommit',
    label: 'Go to Commit…',
    group: 'Navigate',
    keys: ['Mod+Shift+G'],
    when: hasRepo,
    run: () => useUiStore().openDialog('navigate.goToCommit')
  });

  defineCommand({
    id: 'navigate.quickSearchNext',
    label: 'Quick Search Next',
    group: 'Navigate',
    keys: ['Alt+Down'],
    when: hasRepo,
    run: () => useQuickSearchStore().repeat(1)
  });

  defineCommand({
    id: 'navigate.quickSearchPrevious',
    label: 'Quick Search Previous',
    group: 'Navigate',
    keys: ['Alt+Up'],
    when: hasRepo,
    run: () => useQuickSearchStore().repeat(-1)
  });
}
