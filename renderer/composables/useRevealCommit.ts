/**
 * Move grid selection to a commit, or say why it can't (not in grid, setting hides it, etc).
 * Shared by three surfaces: left panel, Navigate commands, Go to Commit dialog.
 */

import { artificialKind, ROW_KIND_INDEX, ROW_KIND_WORKING_TREE } from '@shared/artificial.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { BRANCH_SCOPE_CURRENT, useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';


export interface RevealOptions {
  /**
   * Add to selection (Mod-click). Two commits selected together for compare/rebase onto.
   */
  toggle?: boolean;
  /**
   * Message for commit not existing at all (distinct from: exists but outside loaded history).
   */
  missing?: string;
  /**
   * Say nothing when there is no row to go to. For a reveal nobody asked for: the grid
   * following HEAD after a checkout is a courtesy, and a toast explaining that HEAD is
   * past the commit limit is an answer to a question that was never put.
   */
  quiet?: boolean;
}

export interface RevealCommit {
  reveal: (sha: string | null | undefined, options?: RevealOptions) => boolean;
}

export function useRevealCommit(): RevealCommit
{
  const revisions = useRevisionsStore();
  const selection = useSelectionStore();
  const settings = useSettingsStore();
  const ui = useUiStore();

  /**
   * Message for why a SHA has no row (artificial rows handled separately).
   */
  function missingRowMessage(sha: string): string
  {
    switch (artificialKind(sha))
    {
      case ROW_KIND_WORKING_TREE:
        return 'Nothing is uncommitted, so there is no working-tree row.';
      case ROW_KIND_INDEX:
        return 'Nothing is staged, so there is no index row.';
      default:
        break;
    }
    if (settings.settings.branchScope === BRANCH_SCOPE_CURRENT)
    {
      return 'Showing the current branch only. View ▸ Show All Branches.';
    }
    else
    {
      return 'Outside the loaded history: raise the commit limit in Settings.';
    }
  }

  function isMissingSha(sha: string | null | undefined): sha is null | undefined | ''
  {
    return sha === null || sha === undefined || sha === '';
  }

  function reveal(sha: string | null | undefined, options: RevealOptions = {}): boolean
  {
    if (isMissingSha(sha))
    {
      if (!options.quiet)
      {
        ui.toast(options.missing ?? 'There is no commit to go to.', 'info');
      }
      return false;
    }

    // A commit limit, a branch filter, or a shallow clone can all leave a commit that
    // exists in the repository and not in the grid.
    if (revisions.rowOf(sha) === undefined)
    {
      if (!options.quiet)
      {
        ui.toast(missingRowMessage(sha), 'info');
      }
      return false;
    }

    if (options.toggle)
    {
      selection.toggle(sha);
    }
    else
    {
      selection.select(sha);
    }
    return true;
  }

  return { reveal };
}
