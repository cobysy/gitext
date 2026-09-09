/**
 * Left panel commands: declared here, built in `objects.actions.ts`.
 * Imports only the registry to keep menu declarations unit-testable.
 */

import { declareCommand, hasRepo, type CommandContext } from './registry.js';
import {
  KIND_BRANCH,
  KIND_REMOTE,
  KIND_REMOTE_BRANCH,
  KIND_STASH,
  KIND_SUBMODULE,
  KIND_TAG,
  KIND_WORKTREE,
  type PanelNodeKind
} from '@renderer/panel.js';

function nodeIs(...kinds: PanelNodeKind[]): (c: CommandContext) => boolean
{
  return (c) => c.hasRepo && c.selectedNode !== null && kinds.includes(c.selectedNode.kind);
}

const anyRef = nodeIs(KIND_BRANCH, KIND_REMOTE_BRANCH, KIND_TAG);
const localBranch = nodeIs(KIND_BRANCH);
const remoteNode = nodeIs(KIND_REMOTE);
// Deactivated remotes: config is `-remote.<name>`, so git ignores operations on them.
const activeRemote = (c: CommandContext): boolean =>
  remoteNode(c) && c.selectedNode?.isDisabled !== true;
const inactiveRemote = (c: CommandContext): boolean =>
  remoteNode(c) && c.selectedNode?.isDisabled === true;
const remoteBranch = nodeIs(KIND_REMOTE_BRANCH);
const stashNode = nodeIs(KIND_STASH);
const submoduleNode = nodeIs(KIND_SUBMODULE);
const worktreeNode = nodeIs(KIND_WORKTREE);

const notCurrent =
  (base: (c: CommandContext) => boolean) =>
    (c: CommandContext): boolean =>
      base(c) && c.selectedNode?.isCurrent !== true;

export function registerObjectCommands(): void
{
  // ── Any ref ─────────────────────────────────────────────────────────────────
  declareCommand('ref.checkout', 'Checkout', 'Branch', anyRef);
  declareCommand('ref.merge', 'Merge into Current Branch…', 'Branch', anyRef);
  declareCommand('ref.rebaseCurrentOn', 'Rebase Current Branch on This…', 'Branch', anyRef);
  declareCommand('ref.resetCurrentTo', 'Reset Current Branch to This…', 'Reset', anyRef);
  // Move another branch here: uses `update-ref`, works during a rebase/merge on current branch.
  declareCommand('ref.resetOtherBranchTo', 'Reset Another Branch to This…', 'Reset', anyRef);
  declareCommand('ref.createBranch', 'Create Branch from This…', 'Branch', anyRef);
  declareCommand('ref.compareToCurrent', 'Compare to Current Branch…', 'Compare', anyRef);
  declareCommand('ref.filterGrid', 'Filter Grid by This Ref', 'View', anyRef);

  // ── Local branches ──────────────────────────────────────────────────────────
  declareCommand('ref.rename', 'Rename…', 'Branch', localBranch);
  declareCommand('ref.setUpstream', 'Set Upstream…', 'Branch', localBranch);
  declareCommand('ref.delete', 'Delete…', 'Branch', notCurrent(nodeIs(KIND_BRANCH, KIND_TAG)));
  // Labels differ to avoid duplicate "Push…" in palette: this pushes the panel row, remote.push pushes current.
  declareCommand('ref.push', 'Push This Branch…', 'Remote', localBranch);
  // Every merged branch at once, so no row in the panel is its operand: it lives in the
  // toolbar's maintenance menu, with the rest of the repo-wide housekeeping.
  declareCommand('branch.cleanup', 'Clean Up Merged Branches…', 'Branch', hasRepo);

  // ── Remotes ─────────────────────────────────────────────────────────────────
  declareCommand('remote.pull', 'Pull / Fetch…', 'Remote', hasRepo, ['Mod+Shift+L']);
  declareCommand('remote.push', 'Push…', 'Remote', hasRepo, ['Mod+Shift+P']);
  declareCommand('remote.manage', 'Manage Remotes…', 'Remote', hasRepo);
  declareCommand('remote.fetchAll', 'Fetch All Remotes', 'Remote', hasRepo);
  // The housekeeping half of the pair: every remote, dropping the remote-tracking
  // branches whose upstream is gone. Repo-wide, so its home is the toolbar's
  // maintenance menu rather than a remote's own row, which `remote.fetchPrune` has.
  declareCommand('remote.fetchAllPrune', 'Fetch All Remotes and Prune', 'Remote', hasRepo);
  declareCommand('remote.fetch', 'Fetch', 'Remote', activeRemote);
  declareCommand('remote.fetchPrune', 'Fetch and Prune', 'Remote', activeRemote);
  declareCommand('remote.enable', 'Activate Remote', 'Remote', inactiveRemote);
  declareCommand('remote.enableAndFetch', 'Activate Remote and Fetch', 'Remote', inactiveRemote);
  declareCommand('remote.disable', 'Deactivate Remote', 'Remote', activeRemote);
  declareCommand('remote.openUrl', 'Open Remote URL in Browser', 'Remote', remoteNode);
  declareCommand('remote.deleteBranches', 'Delete Remote Branches…', 'Remote', activeRemote);

  // ── Remote branches ─────────────────────────────────────────────────────────
  // One branch (by refspec), not the whole remote.
  declareCommand('remoteBranch.fetch', 'Fetch This Branch', 'Remote', remoteBranch);
  declareCommand('remoteBranch.fetchCheckout', 'Fetch and Checkout', 'Remote', remoteBranch);
  declareCommand('remoteBranch.pull', 'Fetch and Merge (Pull)', 'Remote', remoteBranch);
  declareCommand('remoteBranch.fetchRebase', 'Fetch and Rebase', 'Remote', remoteBranch);
  // Label emphasizes the fetch difference from ref.createBranch.
  declareCommand('remoteBranch.fetchCreateBranch', 'Fetch and Create Branch…', 'Remote', remoteBranch);
  declareCommand('remoteBranch.delete', 'Delete Remote Branch…', 'Remote', remoteBranch);

  // ── Tags ────────────────────────────────────────────────────────────────────
  declareCommand('tag.push', 'Push Tag…', 'Tag', nodeIs(KIND_TAG));

  // ── Stashes ─────────────────────────────────────────────────────────────────
  declareCommand('stash.open', 'Open Stash', 'Stash', stashNode);
  // No accelerator: `Mod+Shift+S` copies the selected commit's SHA, declared earlier and
  // so reached first by the hotkey handler. It is a toolbar row and a menu row instead.
  // One row, not two: what to sweep in is four checkboxes in the dialog, and "all" and
  // "staged" were two of them promoted to menu rows that read as different operations.
  // The commit screen keeps its own `staging.stashStaged`, where the staged half is what
  // you are already looking at.
  declareCommand('stash.save', 'Stash Changes…', 'Stash', (c) => c.hasRepo && c.hasChanges);
  declareCommand('stash.manage', 'Manage Stashes…', 'Stash', hasRepo);

  // ── Submodules ──────────────────────────────────────────────────────────────
  declareCommand('submodule.open', 'Open Submodule', 'Submodule', submoduleNode);
  declareCommand('submodule.openInNewWindow', 'Open Submodule in New Window', 'Submodule', submoduleNode);
  declareCommand('submodule.update', 'Update Submodule', 'Submodule', submoduleNode);
  declareCommand('submodule.reset', 'Reset Submodule Changes…', 'Submodule', submoduleNode);
  declareCommand('submodule.stash', 'Stash Submodule Changes…', 'Submodule', submoduleNode);
  declareCommand('submodule.commit', 'Commit Submodule Changes…', 'Submodule', submoduleNode);
  declareCommand('submodule.sync', 'Synchronize Submodules', 'Submodule', hasRepo);
  declareCommand('submodule.updateAll', 'Update All Submodules', 'Submodule', hasRepo);
  declareCommand('submodule.manage', 'Manage Submodules…', 'Submodule', hasRepo);

  // ── Worktrees ───────────────────────────────────────────────────────────────
  declareCommand('worktree.create', 'Create Worktree…', 'Worktree', hasRepo);
  declareCommand('worktree.open', 'Open Worktree', 'Worktree', notCurrent(worktreeNode));
  declareCommand('worktree.delete', 'Delete Worktree…', 'Worktree', notCurrent(worktreeNode));
  // Repo-wide, like `branch.cleanup`: it drops the records of every worktree whose
  // directory is gone, so the toolbar's maintenance menu is its home.
  declareCommand('worktree.prune', 'Prune Worktrees', 'Worktree', hasRepo);
  declareCommand('worktree.manage', 'Manage Worktrees…', 'Worktree', hasRepo);
}
