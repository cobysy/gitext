/**
 * The View menu. Most of these are toggles over how the grid draws itself, declared
 * together so later-phase ones sit greyed beside working ones. Every built toggle
 * persists through the settings store: `settings:patch` broadcasts `event:settings` so
 * other windows adopt the value rather than holding what they loaded with.
 */

import { defineCommand, hasRepo } from './registry.js';
import {
  COLUMN_LABELS,
  isHideable,
  normalizeColumns,
  setColumnVisible,
  type ColumnId
} from '@renderer/columns.js';
import { useCommandLogStore } from '@renderer/stores/commandLog.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { BRANCH_SCOPE_CURRENT, useSettingsStore } from '@renderer/stores/settings.js';
import {
  GRAPH_DIM_ALL,
  GRAPH_DIM_LANES,
  GRAPH_DIM_NONE,
  type GraphDimming
} from '@shared/types.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { refreshRepository } from '@renderer/composables/useRepositoryRefresh.js';


const COMMIT_INFO_LEFT = 'left';
const COMMIT_INFO_RIGHT = 'right';
const BRANCH_SCOPE_ALL = 'all';
const BRANCH_SCOPE_FILTERED = 'filtered';

/** Whether the grid is currently drawing `id`, through the same reconciliation it draws by. */
function isColumnVisible(id: ColumnId): boolean
{
  const columns = normalizeColumns(useSettingsStore().settings.gridColumns);
  return columns.find((c) => c.id === id)?.visible ?? true;
}

/**
 * How far the non-relative dimming reaches: one command per rung, generated from the
 * table so the three cannot drift into saying different things about one setting.
 */
const DIMMING_COMMANDS: { id: string; label: string; value: GraphDimming }[] = [
  { id: 'view.grayNonRelativesOff', label: 'Draw Non-Relatives in Full Colour', value: GRAPH_DIM_NONE },
  { id: 'view.grayNonRelatives', label: 'Draw Non-Relative Lanes Gray', value: GRAPH_DIM_LANES },
  { id: 'view.grayNonRelativesText', label: 'Draw Non-Relative Lanes and Text Gray', value: GRAPH_DIM_ALL }
];

function registerDimmingCommands(): void
{
  for (const { id, label, value } of DIMMING_COMMANDS)
  {
    defineCommand({
      id,
      label,
      group: 'View',
      when: hasRepo,
      checked: () => useSettingsStore().settings.graphDimNonRelatives === value,
      run: () => useSettingsStore().patch({ graphDimNonRelatives: value })
    });
  }
}

/**
 * Column visibility, one command per column, generated from the column model so the
 * menu cannot list a column the grid does not have.
 */
function registerColumnCommands(): void
{
  for (const id of Object.keys(COLUMN_LABELS) as ColumnId[])
  {
    if (!isHideable(id))
    {
      continue;
    }
    defineCommand({
      id: `view.column.${id}`,
      label: COLUMN_LABELS[id],
      group: 'Columns',
      when: hasRepo,
      // Reconciled rather than read raw, the same as the run below: a stored layout from
      // an older build may not mention this column at all, and an absent entry is a
      // column that is showing.
      checked: () => isColumnVisible(id),
      run: () =>
      {
        const settings = useSettingsStore();
        const columns = normalizeColumns(settings.settings.gridColumns);
        const current = columns.find((c) => c.id === id);
        return settings.patch({
          gridColumns: setColumnVisible(columns, id, !(current?.visible ?? true))
        });
      }
    });
  }
}

export function registerViewCommands(): void
{
  defineCommand({
    id: 'view.refresh',
    label: 'Refresh',
    group: 'View',
    keys: ['F5'],
    when: hasRepo,
    // Everything: the status, the panel, the grid, the diff and the tree. Refresh is the
    // answer to "something changed underneath the app and it has not noticed", so it can
    // assume nothing about what that something was.
    run: () => refreshRepository()
  });

  defineCommand({
    id: 'view.toggleCommandLog',
    label: 'Toggle Command Log',
    group: 'View',
    keys: ['Mod+`'],
    checked: () => useCommandLogStore().visible,
    run: () => useCommandLogStore().toggle()
  });

  // No hotkey on purpose: the keys this project binds are fixed, and there is no
  // established one for hiding this pane.
  defineCommand({
    id: 'view.toggleCommitDetails',
    label: 'Toggle Commit Details',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.showCommitDetails,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ showCommitDetails: !settings.settings.showCommitDetails });
    }
  });

  // The band under the grid, which the commit details toggle used to take with it: two
  // panes answering different questions, so each is hidden on its own.
  defineCommand({
    id: 'view.toggleFilePane',
    label: 'Toggle Files and Diff',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.showFilePane,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ showFilePane: !settings.settings.showFilePane });
    }
  });

  // A two-way selector like the branch scope below: one setting, two rows, each naming its own answer.
  defineCommand({
    id: 'view.commitInfoLeft',
    label: 'Commit Info Left of the Grid',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.commitInfoPosition === COMMIT_INFO_LEFT,
    run: () => useSettingsStore().patch({ commitInfoPosition: COMMIT_INFO_LEFT })
  });

  defineCommand({
    id: 'view.commitInfoRight',
    label: 'Commit Info Right of the Grid',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.commitInfoPosition === COMMIT_INFO_RIGHT,
    run: () => useSettingsStore().patch({ commitInfoPosition: COMMIT_INFO_RIGHT })
  });

  defineCommand({
    id: 'view.toggleLeftPanel',
    label: 'Toggle Left Panel',
    group: 'View',
    keys: ['Mod+B'],
    when: hasRepo,
    checked: () => useSettingsStore().settings.showLeftPanel,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ showLeftPanel: !settings.settings.showLeftPanel });
    }
  });

  // ── Commits shown ───────────────────────────────────────────────────────────
  // The View menu's "Show artificial commits". Persisted, so it survives a restart;
  // the grid derives its rows from the setting rather than holding a second copy.
  defineCommand({
    id: 'view.toggleArtificialCommits',
    label: 'Show Working and Index Rows',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.showArtificialCommits,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({
        showArtificialCommits: !settings.settings.showArtificialCommits
      });
    }
  });

  // ── Which refs the grid walks ───────────────────────────────────────────────
  // A three-way selector, not three independent toggles. "All" is the default: walking
  // HEAD alone hides unmerged branches and tags, leaving the panel pointing at commits off screen.
  defineCommand({
    id: 'view.branchesAll',
    label: 'Show All Branches',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.branchScope === BRANCH_SCOPE_ALL,
    run: () => useSettingsStore().patch({ branchScope: BRANCH_SCOPE_ALL })
  });

  defineCommand({
    id: 'view.branchesCurrent',
    label: 'Show Current Branch Only',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.branchScope === BRANCH_SCOPE_CURRENT,
    run: () => useSettingsStore().patch({ branchScope: BRANCH_SCOPE_CURRENT })
  });

  // ── How the graph draws itself ──────────────────────────────────────────────
  // These are preferences, not mid-session reaches, so their home is Settings > Graph,
  // not the View menu: `main/menu.ts` doesn't list them. Still `defineCommand`d, so the
  // palette finds them.
  //
  // Two controls over one effect: a persisted setting dims everything outside the
  // checked-out branch, and a transient override re-points that at another commit,
  // winning while set. How much is dimmed is a three-way selector, not two toggles: the
  // state two booleans would also allow (text grey, lanes lit) reads as a fault, not a choice.
  registerDimmingCommands();

  // The one setting that changes the shape of the graph rather than what is drawn over
  // it, so flipping it re-lays out rather than merely redrawing.
  defineCommand({
    id: 'view.mergeCommonParentLanes',
    label: 'Merge Lanes Having a Common Parent',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.graphMergeCommonParentLanes,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({
        graphMergeCommonParentLanes: !settings.settings.graphMergeCommonParentLanes
      });
    }
  });

  // Deliberately not bound to the selection: this is the one place the highlight moves,
  // so clicking around the grid leaves the checked-out branch lit. `checked` makes the "(until refresh)" label legible.
  defineCommand({
    id: 'view.highlightBranch',
    label: 'Highlight Selected Branch',
    group: 'View',
    when: (c) => c.hasRepo && c.selectionCount > 0,
    checked: () => useRevisionsStore().highlightSeed !== null,
    run: () =>
    {
      const revisions = useRevisionsStore();
      const primary = useSelectionStore().primary;
      // Clicking it again with the same commit turns it back off, so the command that
      // sets the override is also the one that clears it.
      if (revisions.highlightSeed === primary)
      {
        revisions.highlightSeed = null;
      }
      else
      {
        revisions.highlightSeed = primary;
      }
    }
  });

  registerColumnCommands();

  // ── The branch scope's third state, and the dialog that fills it in ────────
  // Superproject branches/tags and git notes were declared here too, once, and are cut rather than built.
  defineCommand({
    id: 'view.branchesFiltered',
    label: 'Show Filtered Branches',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.branchScope === BRANCH_SCOPE_FILTERED,
    // Whatever pattern is already in `branchFilter`: this flips the checkbox, not the text box beside it.
    run: () => useSettingsStore().patch({ branchScope: BRANCH_SCOPE_FILTERED })
  });

  defineCommand({
    id: 'view.advancedFilter',
    label: 'Advanced Filter…',
    group: 'View',
    when: hasRepo,
    // The payload rule: the dialog is a window of its own with no `revisions` store,
    // so what it opens on has to travel with it rather than be read again once it has
    // loaded: see `shared/dialogs.ts`'s `DialogPayload.logFilter`.
    run: () => useUiStore().openDialog('view.advancedFilter', { logFilter: useRevisionsStore().options })
  });

  // ── Commits and grid labels ─────────────────────────────────────────────────
  // All four default `true` (`logShowReflog` the exception): every ref badge the grid
  // draws is unconditional today, so a toggle defaulted off would hide branches and tags visible right now.
  defineCommand({
    id: 'view.showReflog',
    label: 'Show Reflog References',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.logShowReflog,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ logShowReflog: !settings.settings.logShowReflog });
    }
  });

  defineCommand({
    id: 'view.showStashes',
    label: 'Show Stashes',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.logShowStashes,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ logShowStashes: !settings.settings.logShowStashes });
    }
  });

  defineCommand({
    id: 'view.showRemoteBranches',
    label: 'Show Remote Branches',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.logShowRemoteBranches,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ logShowRemoteBranches: !settings.settings.logShowRemoteBranches });
    }
  });

  defineCommand({
    id: 'view.showTags',
    label: 'Show Tags',
    group: 'View',
    when: hasRepo,
    checked: () => useSettingsStore().settings.logShowTags,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ logShowTags: !settings.settings.logShowTags });
    }
  });
}
