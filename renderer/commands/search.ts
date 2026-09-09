/**
 * File-content search (`git grep`): only search that reads files (others use metadata).
 * Two commands: dialog-pointed search, and right-click-commit search (operand differs).
 */

import { defineCommand } from './registry.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useUiStore } from '@renderer/stores/ui.js';

const GROUP_SEARCH = 'Search';
const DIALOG_SEARCH_GREP = 'search.grep';

export function registerSearchCommands(): void
{
  defineCommand({
    id: 'search.grep',
    label: 'Find in Files…',
    group: GROUP_SEARCH,
    // What every editor binds it to, and it was free: the Edit menu's `Find…` row carried
    // this accelerator while dispatching a command id nothing had ever registered, so
    // pressing it raised "unknown command": see `main/menu.ts`.
    keys: ['Mod+Shift+F'],
    when: (c) => c.hasRepo,
    run: () => useUiStore().openDialog(DIALOG_SEARCH_GREP)
  });

  defineCommand({
    id: 'search.grepCommit',
    label: "Find in This Commit's Files…",
    group: GROUP_SEARCH,
    // One commit, and a real one: the working-tree and index rows are endpoints the dialog
    // offers anyway, and their sentinel SHAs must never reach git.
    when: (c) => c.hasRepo && c.selectionCount === 1 && !c.hasArtificialSelection,
    run: () =>
    {
      const sha = useSelectionStore().primary;
      if (sha)
      {
        useUiStore().openDialog(DIALOG_SEARCH_GREP, { sha });
      }
    }
  });
}
