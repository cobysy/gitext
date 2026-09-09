/**
 * Route table: which component each dialog renders, as the import that fetches it.
 * Keyed by DialogName (fails typecheck if not paired). Payload-to-props mapping in
 * props.ts (shared/dialogs.ts has name, title, size for main).
 *
 * **Every route is an import, not a component.** `dialog.html` is one bundle for every
 * dialog in the app, so a static import here puts all fifty forms, and whatever any of
 * them reaches (Monaco, for the four that are editors), in front of the one window being
 * opened: a branch checkout paid for the conflict editor. As loaders, a window fetches
 * its own form and nothing else.
 *
 * `DialogHost` starts the import at setup rather than rendering `defineAsyncComponent`,
 * which would not begin loading until the bootstrap it is gated behind had finished: the
 * fetch and the settings/repository round trip are the two things a dialog waits for, and
 * they have no reason to wait for each other.
 */

import type { Component } from 'vue';
import type { DialogName } from '@shared/dialogs.js';

/** What a route hands back: a `.vue` module, whose default export is the form. */
export type DialogModule = { default: Component };

export const DIALOG_COMPONENTS: Record<DialogName, () => Promise<DialogModule>> = {
  settings: () => import('@renderer/components/dialogs/SettingsDialog.vue'),
  about: () => import('@renderer/components/dialogs/AboutDialog.vue'),
  'repo.clone': () => import('@renderer/components/dialogs/CloneDialog.vue'),
  'repo.init': () => import('@renderer/components/dialogs/InitRepoDialog.vue'),
  shortcuts: () => import('@renderer/components/dialogs/ShortcutsDialog.vue'),

  'branch.checkout': () => import('@renderer/components/dialogs/CheckoutBranchDialog.vue'),
  'branch.create': () => import('@renderer/components/dialogs/CreateBranchDialog.vue'),
  'branch.rename': () => import('@renderer/components/dialogs/RenameBranchDialog.vue'),
  'branch.setUpstream': () => import('@renderer/components/dialogs/SetUpstreamDialog.vue'),
  'branch.delete': () => import('@renderer/components/dialogs/DeleteBranchDialog.vue'),
  'branch.deleteRemote': () => import('@renderer/components/dialogs/DeleteRemoteBranchDialog.vue'),
  'branch.cleanup': () => import('@renderer/components/dialogs/CleanUpBranchesDialog.vue'),
  'branch.merge': () => import('@renderer/components/dialogs/MergeBranchDialog.vue'),
  'branch.rebase': () => import('@renderer/components/dialogs/RebaseDialog.vue'),

  'reset.branch': () => import('@renderer/components/dialogs/ResetBranchDialog.vue'),
  'reset.changes': () => import('@renderer/components/dialogs/ResetChangesDialog.vue'),
  'reset.other': () => import('@renderer/components/dialogs/ResetOtherBranchDialog.vue'),

  'tag.create': () => import('@renderer/components/dialogs/CreateTagDialog.vue'),
  'tag.delete': () => import('@renderer/components/dialogs/DeleteTagDialog.vue'),

  compare: () => import('@renderer/components/dialogs/CompareDialog.vue'),
  stash: () => import('@renderer/components/dialogs/StashDialog.vue'),
  'stash.manage': () => import('@renderer/components/dialogs/ManageStashesDialog.vue'),

  'remote.pull': () => import('@renderer/components/dialogs/PullDialog.vue'),
  'remote.push': () => import('@renderer/components/dialogs/PushDialog.vue'),
  'remote.manage': () => import('@renderer/components/dialogs/ManageRemotesDialog.vue'),

  'commit.open': () => import('@renderer/components/commit/CommitScreen.vue'),
  'commit.cherry-pick': () => import('@renderer/components/dialogs/CherryPickDialog.vue'),
  'commit.revert': () => import('@renderer/components/dialogs/RevertDialog.vue'),
  // Its own dialog, not the branch one with a different title: a commit has no branch to
  // pick and no tracking to set up, and it has a detached HEAD to warn about.
  'commit.checkout': () => import('@renderer/components/dialogs/CheckoutRevisionDialog.vue'),
  'commit.archive': () => import('@renderer/components/dialogs/ArchiveDialog.vue'),
  'commit.undo': () => import('@renderer/components/dialogs/UndoCommitDialog.vue'),
  'commit.reword': () => import('@renderer/components/dialogs/RewordCommitDialog.vue'),

  'workdir.clean': () => import('@renderer/components/dialogs/CleanDialog.vue'),

  'repo.gc': () => import('@renderer/components/dialogs/GcDialog.vue'),
  'repo.fsck': () => import('@renderer/components/dialogs/FsckDialog.vue'),

  'worktree.create': () => import('@renderer/components/dialogs/CreateWorktreeDialog.vue'),
  'worktree.manage': () => import('@renderer/components/dialogs/ManageWorktreesDialog.vue'),

  'submodule.manage': () => import('@renderer/components/dialogs/ManageSubmodulesDialog.vue'),

  'patch.apply': () => import('@renderer/components/dialogs/ApplyPatchDialog.vue'),
  'patch.format': () => import('@renderer/components/dialogs/FormatPatchDialog.vue'),
  'patch.view': () => import('@renderer/components/dialogs/ViewPatchDialog.vue'),

  'repo.editFile': () => import('@renderer/components/dialogs/EditRepoFileDialog.vue'),
  'file.ignore': () => import('@renderer/components/dialogs/IgnoreDialog.vue'),
  'file.move': () => import('@renderer/components/dialogs/RenameFileDialog.vue'),
  'file.history': () => import('@renderer/components/dialogs/FileHistoryDialog.vue'),

  'conflicts.resolve': () => import('@renderer/components/dialogs/ResolveConflictsDialog.vue'),
  'conflicts.editFile': () => import('@renderer/components/dialogs/ConflictFileDialog.vue'),

  'navigate.goToCommit': () => import('@renderer/components/dialogs/GoToCommitDialog.vue'),

  'search.grep': () => import('@renderer/components/dialogs/FindInFilesDialog.vue'),

  'view.advancedFilter': () => import('@renderer/components/dialogs/AdvancedFilterDialog.vue'),

  commandOutput: () => import('@renderer/components/dialogs/CommandOutputDialog.vue')
};

export { propsFor } from './props.js';
