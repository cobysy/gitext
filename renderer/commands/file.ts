/**
 * What can be done to a file in the changed-files list: declared, not built here.
 * Imports nothing but the registry, so `menus/fileList.ts` is unit-testable under Node;
 * building one calls `implementCommand` in `commands/file.actions.ts` or `workingFile.ts`.
 *
 * *Every* file command is declared here, including ones that already work: declaring
 * one outright in `workingFile.ts` would put it out of reach of the menu tests, which
 * can't load that module under Node.
 */

import { declareCommand, hasFile, type CommandContext } from './registry.js';
import { ENDPOINT_KIND_COMMIT } from '@shared/diff.js';
import { FILE_STATUS_DELETED, FILE_STATUS_UNTRACKED } from '@shared/types.js';

const FILE_SOURCE_WORKING_TREE = 'workingTree';
const FILE_SOURCE_INDEX = 'index';


const hasWorkingFile = (c: CommandContext): boolean =>
  hasFile(c) && c.selectedFile?.status !== FILE_STATUS_DELETED;

/**
 * A file git is actually tracking: the three `update-index` flags below all take a
 * tracked path, and asking on one git has never seen fails with a message that reads as a bug.
 */
const hasTrackedFile = (c: CommandContext): boolean =>
  hasFile(c) && c.selectedFile?.status !== FILE_STATUS_UNTRACKED;

/**
 * A file the working tree has, rather than one a commit had: a row from a two-year-old
 * commit looks identical to one from `git status`, and every working-tree command
 * (stage, unstage, discard, rename, delete) needs to tell them apart. `fileSource` answers it.
 */
const inWorkingCopy = (c: CommandContext): boolean =>
  hasFile(c) && c.fileSource !== ENDPOINT_KIND_COMMIT;

/**
 * Only the unstaged half, and only the staged half: decided by the pivot, so it holds
 * on both surfaces. Offering "Stage" on a staged file would be a no-op; on a commit's file, a lie.
 */
const canStage = (c: CommandContext): boolean =>
  hasFile(c) && c.fileSource === FILE_SOURCE_WORKING_TREE;
const canUnstage = (c: CommandContext): boolean => hasFile(c) && c.fileSource === FILE_SOURCE_INDEX;

/** Two files picked in the file pane, which is what comparing them against each other needs. */
const hasTwoFiles = (c: CommandContext): boolean => c.hasRepo && c.fileSelectionCount === 2;

/**
 * The file hotkeys: bare letters, so scoped (see `CommandDef.scope`), declared on the
 * commands rather than the component so the menu row can show the accelerator. Two
 * scopes for most, since both surfaces are file lists; `FILE_PANE` alone is for the ones
 * whose operand (a pivot end, a grid filter) the commit screen has no meaning for.
 */
const FILE_PANE = 'fileList' as const;
const FILE_LISTS = ['fileList', 'commitScreen'] as const;

export function registerFileCommands(): void
{
  // Hands the file to the OS, unlike the edit below it: the OS decides what "open"
  // means, the way double-clicking it in Finder would.
  declareCommand('file.open', 'Open Working File', 'File', hasWorkingFile, ['Shift+F4'], FILE_LISTS);
  declareCommand('file.editWorkingFile', 'Edit Working File', 'File', hasWorkingFile, ['F4'], FILE_LISTS);
  declareCommand('file.openWith', 'Open Working File With…', 'File', hasWorkingFile, ['Mod+Shift+F4'], FILE_LISTS);
  declareCommand('file.openRevision', 'Open This Revision', 'File', hasFile, ['Mod+F3'], FILE_LISTS);
  declareCommand('file.openRevisionWith', 'Open This Revision With…', 'File', hasFile, ['Mod+Shift+F3'], FILE_LISTS);
  // `F3` is the pivot's own comparison, a question both surfaces have. The two below
  // re-run difftool against the working directory instead, needing ends to choose between, so they're the file pane's alone.
  declareCommand('file.openWithDifftool', 'Open with Difftool', 'File', hasFile, ['F3'], FILE_LISTS);
  declareCommand('file.diffFirstToWorking', 'Compare: First → Working Directory', 'File', hasFile, ['Alt+F3'], FILE_PANE);
  declareCommand('file.diffSecondToWorking', 'Compare: Second → Working Directory', 'File', hasFile, ['Shift+Alt+F3'], FILE_PANE);
  declareCommand('file.diffSelected', 'Compare the Two Selected Files', 'File', hasTwoFiles);

  declareCommand('file.stage', 'Stage Selected', 'File', canStage, ['S'], FILE_LISTS);
  declareCommand('file.unstage', 'Unstage Selected', 'File', canUnstage, ['U'], FILE_LISTS);
  // `R` on the commit screen, where it's the only reset on offer: the pivot-relative pair below has no meaning there.
  declareCommand('file.reset', 'Reset File Changes…', 'File', (c) => inWorkingCopy(c), ['R'], 'commitScreen');

  // "Reset file(s) to": the same checkout, from either end of the pivot. Unlike the
  // discard above, these *are* meaningful on a commit: restoring a file as it was
  // before one undoes a single file's worth of a bad commit. Barred from a combined/range diff.
  declareCommand('file.resetToParent', 'Reset to First…', 'File', hasFile, ['R'], FILE_PANE);
  declareCommand('file.resetToSelected', 'Reset to Second…', 'File', hasFile);
  // A hunk to reset is something only the commit screen's diff offers.
  declareCommand('file.resetChunk', 'Reset Chunk of File…', 'File', (c) => hasFile(c) && c.stagingSide !== null);
  // Cherry-picking a file's changes *into* the working tree needs them to be somewhere
  // else to begin with.
  declareCommand('file.cherryPickChanges', 'Cherry-pick into Working Tree', 'File', (c) => hasFile(c) && c.fileSource !== FILE_SOURCE_WORKING_TREE);
  declareCommand('file.move', 'Rename / Move…', 'File', (c) => hasWorkingFile(c) && inWorkingCopy(c), ['F2'], FILE_LISTS);
  declareCommand('file.delete', 'Delete File…', 'File', (c) => hasWorkingFile(c) && inWorkingCopy(c), ['Delete'], FILE_LISTS);
  declareCommand('file.ignore', 'Add to .gitignore…', 'File', hasFile);
  declareCommand('file.exclude', 'Add to .git/info/exclude…', 'File', hasFile);
  // Save the file as it is at the *newer* end of the comparison: the only end that needs
  // no explaining, since "save this file" means the version the list is showing.
  declareCommand('file.saveAs', 'Save File As…', 'File', hasWorkingFile);
  // A different verb from `file.open`, and so a different channel in `main/ipc`: opening
  // runs the file's default application, showing it opens the folder around it.
  declareCommand('file.showInFolder', 'Show in Finder', 'File', hasWorkingFile);
  declareCommand('file.showInFileTree', 'Show in File Tree', 'File', hasFile, ['T'], FILE_LISTS);
  // Both forms, for the same reason as the two SHAs: the relative one goes into a git
  // command or a review comment, the full native one into a terminal or a file dialog.
  declareCommand('file.copyPath', 'Copy Path', 'File', hasFile);
  declareCommand('file.copyFullPath', 'Copy Full Path', 'File', hasFile);
  declareCommand('file.history', 'File History…', 'File', hasFile, ['H'], FILE_LISTS);
  declareCommand('file.blame', 'Blame…', 'File', hasFile, ['B'], FILE_LISTS);
  declareCommand('file.filterInGrid', 'Filter This File in the Grid', 'File', hasFile, ['F'], FILE_PANE);
  declareCommand('file.findInFiles', 'Find in Commit Files…', 'File', (c) => c.hasRepo);

  // The three index flags. Checkable, because each is a state of the file rather than
  // an action on it, and the only way to see the state is the tick.
  declareCommand('file.skipWorktree', 'Skip Worktree', 'File', hasTrackedFile);
  declareCommand('file.assumeUnchanged', 'Assume Unchanged', 'File', hasTrackedFile);
  declareCommand('file.stopTracking', 'Stop Tracking This File…', 'File', hasTrackedFile);

  /**
   * The four submodule rows, available only on a row that *is* a submodule. They were
   * `hasFile`, offering "Update Submodule" over every ordinary file; the context now carries which it is.
   */
  const submoduleFile = (c: CommandContext): boolean => c.selectedFile?.isSubmodule === true;
  declareCommand('file.submoduleUpdate', 'Update Submodule', 'File', submoduleFile);
  declareCommand('file.submoduleReset', 'Reset Submodule Changes…', 'File', submoduleFile);
  declareCommand('file.submoduleStash', 'Stash Submodule Changes…', 'File', submoduleFile);
  declareCommand('file.submoduleCommit', 'Commit Submodule Changes…', 'File', submoduleFile);
}
