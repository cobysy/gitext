/**
 * Implementations for maintenance commands. Not in tsconfig.node.json.
 * Called from commands/index.ts after registerMaintenanceCommands().
 */

import type { RepoTextFile } from '@shared/types.js';
import { implementCommand } from './registry.js';
import { api, toMessage } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';

const DIALOG_REPO_GC = 'repo.gc';
const DIALOG_REPO_FSCK = 'repo.fsck';
const DIALOG_PATCH_VIEW = 'patch.view';

/**
 * Delete `.git/index.lock`: not a dialog (one file, one path). Needs confirmation:
 * can't tell crash from running git. Not suppressible.
 */
async function deleteIndexLock(): Promise<void>
{
  const ui = useUiStore();
  const repoPath = useRepoStore().repo?.path;
  if (!repoPath)
  {
    return;
  }

  const ok = await ui.confirm({
    title: 'Delete index.lock?',
    message:
      'Deleting a `.git/index.lock` a running git still holds corrupts its write.',
    confirmLabel: 'Delete it',
    danger: true
  });
  if (!ok)
  {
    return;
  }

  try
  {
    const existed = await api['repo:deleteIndexLock'](repoPath);
    // Two answers: lock existed or not. Second useful for debugging person.
    let message: string;
    if (existed)
    {
      message = 'Deleted `.git/index.lock`.';
    }
    else
    {
      message = 'There was no `index.lock` to delete.';
    }
    ui.toast(message);
  }
  catch (error)
  {
    ui.toast(toMessage(error), 'error');
  }
}

/** Which command opens the editor on which file: a table, so a fifth is a line. */
const EDITABLE_FILES: readonly (readonly [string, RepoTextFile])[] = [
  ['repo.editGitignore', 'gitignore'],
  ['repo.editExclude', 'exclude'],
  ['repo.editGitattributes', 'gitattributes'],
  ['repo.editConfig', 'config']
];

export function implementMaintenanceCommands(): void
{
  implementCommand(DIALOG_REPO_GC, () => useUiStore().openDialog(DIALOG_REPO_GC));
  implementCommand(DIALOG_REPO_FSCK, () => useUiStore().openDialog(DIALOG_REPO_FSCK));
  implementCommand('repo.deleteIndexLock', () => void deleteIndexLock());

  // The payload is the whole difference between these four; the window is one component.
  for (const [id, target] of EDITABLE_FILES)
  {
    implementCommand(id, () => useUiStore().openDialog('repo.editFile', { repoTextFile: target }));
  }

  implementCommand(DIALOG_PATCH_VIEW, () => useUiStore().openDialog(DIALOG_PATCH_VIEW));
}
