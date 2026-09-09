/**
 * Argv tables: one module per operation, built once and consumed by both preview and run.
 * Pure; never imported by main (built and handed to git:run as data).
 */

export {
  buildAutoStashArgs,
  buildCheckoutArgs,
  buildCheckoutSteps,
  buildStashPopArgs,
  type ArgvStep,
  type CheckoutOptions,
  type CheckoutPlanOptions,
  type LocalChanges,
  type NewBranchMode
} from './checkout.js';

export {
  buildCreateBranchArgs,
  buildCreateBranchSteps,
  buildClearWorkingDirectoryArgs,
  buildDeleteBranchArgs,
  buildRenameBranchArgs,
  buildUpdateRefArgs,
  type CreateBranchOptions
} from './branch.js';

export { buildBranchDeleteSteps, type BranchDeletionPlan } from './branchCleanup.js';

export {
  buildCleanArgs,
  buildCleanSubmodulesArgs,
  CLEAN_MODES,
  type CleanMode,
  type CleanModeInfo,
  type CleanOptions
} from './clean.js';

export {
  buildDiscardSteps,
  buildResetArgs,
  buildUndoCommitArgs,
  DISCARD_SCOPES,
  RESET_MODES,
  type DiscardOptions,
  type DiscardScope,
  type DiscardScopeInfo,
  type ResetMode,
  type ResetModeInfo,
  type ResetOptions
} from './reset.js';

export {
  buildMergeArgs,
  MERGE_STRATEGIES,
  type MergeOptions,
  type MergeStrategy,
  type MergeStrategyInfo
} from './merge.js';

export {
  buildRebaseArgs,
  buildRebaseStepArgs,
  REBASE_DATES,
  REBASE_STEPS,
  type RebaseDates,
  type RebaseOptions,
  type RebaseStep
} from './rebase.js';

export {
  buildMarkResolvedArgs,
  buildMergetoolArgs,
  buildTakeSideSteps,
  CONFLICTED_OPERATIONS,
  CONFLICT_SIDES,
  operationInfo,
  type ConflictedOperation,
  type ConflictSide
} from './conflicts.js';

export {
  buildStashApplyArgs,
  buildStashDropArgs,
  buildStashSaveArgs,
  buildStashShowArgs,
  type StashApplyOptions,
  type StashSaveOptions
} from './stash.js';

export {
  buildFetchArgs,
  buildPullArgs,
  PULL_ACTIONS,
  type FetchOptions,
  type PullAction,
  type PullOptions,
  type TagFetchMode
} from './pull.js';

export {
  buildRemoteAddArgs,
  buildRemoteClearPushUrlArgs,
  buildRemotePruneArgs,
  buildRemoteRemoveArgs,
  buildRemoteRenameArgs,
  buildRemoteSaveSteps,
  buildRemoteSetUrlArgs,
  draftFromRemote,
  type RemoteDraft,
  type RemoteStep
} from './remote.js';

export {
  buildPushAllArgs,
  buildPushArgs,
  buildPushTagArgs,
  FORCE_MODES,
  isRejectedPush,
  REJECTION_REMEDIES,
  rejectionRemedy,
  type ForceMode,
  type PushOptions,
  type RejectionRemedy,
  type SubmodulePushMode
} from './push.js';

export { buildMoveArgs } from './file.js';

export {
  APPLY_MODES,
  buildApplyPatchArgs,
  buildApplyStepArgs,
  buildFormatPatchArgs,
  type ApplyMode,
  type ApplyPatchOptions,
  type ApplyStep,
  type FormatPatchOptions
} from './patch.js';

export {
  buildAddSubmoduleArgs,
  buildRemoveSubmoduleSteps,
  buildSyncSubmodulesArgs,
  buildUpdateSubmoduleArgs,
  type AddSubmoduleOptions,
  type UpdateSubmoduleOptions
} from './submodule.js';

export {
  buildWorktreeAddArgs,
  buildWorktreePruneArgs,
  buildWorktreeRemoveArgs,
  type WorktreeAddOptions,
  type WorktreeCheckout
} from './worktree.js';

export {
  ARCHIVE_FORMATS,
  buildArchiveArgs,
  suggestedArchiveName,
  type ArchiveFormat,
  type ArchiveOptions
} from './archive.js';

export {
  buildCherryPickArgs,
  buildCherryPickStepArgs,
  type CherryPickOptions,
  type CherryPickStep
} from './cherrypick.js';

export {
  buildRevertArgs,
  buildRevertStepArgs,
  type RevertOptions,
  type RevertStep
} from './revert.js';

export { buildRewordSteps, type RewordOptions } from './reword.js';

export {
  buildCreateTagArgs,
  buildDeleteRemoteRefArgs,
  buildDeleteTagArgs,
  TAG_KINDS,
  type CreateTagOptions,
  type TagKind
} from './tag.js';
