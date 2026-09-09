/**
 * What a diff says and what the working tree holds: listing and reading diffs, staging
 * by patch, the index flags, and every channel that reads or writes a file on disk.
 */

import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, dialog, shell } from 'electron';
import { buildDifftoolArgs } from '@shared/diff.js';
import { openWith, writeTempCopy } from '@main/externalOpen.js';
import {
  addIgnoreRules,
  applyPatchToIndex,
  applyPatchToWorkingTree,
  deleteFiles,
  listIndexFlags,
  readIgnoreRules,
  reverseApplyFromIndex,
  setIndexFlag,
  stopTracking
} from '@main/git/stage.js';
import { listDiffFiles, readDiffPatch } from '@main/git/diff.js';
import { checkRepoText, readRepoText, writeRepoText } from '@main/git/repoText.js';
import { readFileAt, readWorkingText, writeWorkingText } from '@main/git/file.js';
import { readConflictBlobs, resolveConflictSides, writeConflictResolution } from '@main/git/conflicts.js';
import {
  runGit
} from '@main/git/runner.js';
import {
  handle,
  handleWrite
} from '../register.js';

export function registerFileHandlers(): void
{
  const STAGE_DIRECTION_UNSTAGE = 'unstage';
  const CHOOSE_PATCH_MODE_FILE = 'file';

  // ── Diffs ───────────────────────────────────────────────────────────────────
  handle('diff:files', (repoPath, range, options) => listDiffFiles(repoPath, range, options));
  handle('diff:patch', (repoPath, range, file, options) =>
    readDiffPatch(repoPath, range, file, options)
  );

  handleWrite('stage:applyPatch', ['index'], (repoPath, patch, direction) =>
  {
    if (direction === STAGE_DIRECTION_UNSTAGE)
    {
      return reverseApplyFromIndex(repoPath, patch);
    }
    else
    {
      return applyPatchToIndex(repoPath, patch);
    }
  }
  );

  // No `--cached`, so the index is untouched: the whole difference from the two above.
  handleWrite('stage:applyToWorkingTree', ['worktree'], (repoPath, patch, reverse) =>
    applyPatchToWorkingTree(repoPath, patch, reverse)
  );
  handleWrite('stage:setIndexFlag', ['index'], (repoPath, paths, flag, on) =>
    setIndexFlag(repoPath, paths, flag, on)
  );
  handle('stage:indexFlags', (repoPath) => listIndexFlags(repoPath));
  // `rm --cached` leaves the file on disk, so only the index moves.
  handleWrite('stage:stopTracking', ['index'], (repoPath, paths) =>
    stopTracking(repoPath, paths)
  );

  // ── Working-tree file operations ────────────────────────────────────────────
  handleWrite('file:delete', ['worktree', 'index'], (repoPath, tracked, untracked) =>
    deleteFiles(repoPath, tracked, untracked)
  );
  handle('file:ignoreRules', (repoPath, target) => readIgnoreRules(repoPath, target));
  // Writing `.gitignore` changes a tracked file; writing `.git/info/exclude` changes which untracked files `status` reports.
  handleWrite('file:addIgnoreRules', ['worktree'], (repoPath, target, patterns) =>
    addIgnoreRules(repoPath, target, patterns)
  );

  handle('file:readRepoText', (repoPath, target) => readRepoText(repoPath, target));
  handle('file:checkRepoText', (repoPath, target, text) => checkRepoText(repoPath, target, text));
  // One facet set for all four targets: an ignore/attributes file changes what the working tree reads as, and `config` is config.
  handleWrite('file:writeRepoText', ['worktree', 'config'], (repoPath, target, text) =>
    writeRepoText(repoPath, target, text)
  );

  handle('file:readWorkingText', (repoPath, path) => readWorkingText(repoPath, path));
  // Only the working tree: editing leaves the index holding whatever was staged, which is what makes the edit an unstaged change.
  handleWrite('file:writeWorkingText', ['worktree'], (repoPath, path, text) =>
    writeWorkingText(repoPath, path, text)
  );

  handle('file:openRevision', async (repoPath, endpoint, path) =>
  {
    // Read-only would be better, but a temp file the user edits and loses beats no way to open it.
    const target = await writeTempCopy(repoPath, endpoint, path);
    shell.openPath(target);
    return target;
  });

  handle('file:difftool', async (repoPath, range, path) =>
  {
    // The argv comes from the same builder the diff reads use, so the log shows the
    // same two ends. `--no-prompt` skips git's own question; a failure is allowed since a difftool opens its own window.
    await runGit(repoPath, buildDifftoolArgs(range, path), { allowFailure: true });
  });

  handle('file:compareTwo', async (repoPath, endpoint, first, second) =>
  {
    // Two paths, not two revisions: `--no-index` compares files on disk, so both ends
    // are written out. Both, not just the older one: at a commit neither is on disk already.
    const [left, right] = await Promise.all([
      writeTempCopy(repoPath, endpoint, first),
      writeTempCopy(repoPath, endpoint, second)
    ]);
    await runGit(repoPath, ['difftool', '--no-prompt', '--no-index', '--', left, right], {
      allowFailure: true
    });
  });

  handle('file:openRevisionWith', async (repoPath, endpoint, path) =>
  {
    await openWith(await writeTempCopy(repoPath, endpoint, path));
  });

  handle('file:openWith', (nativePath) => openWith(nativePath));

  handle('file:chooseDirectory', async (defaultPath) =>
  {
    const result = await dialog.showOpenDialog({
      title: 'Choose a Folder',
      defaultPath: defaultPath || app.getPath('home'),
      // `createDirectory` is macOS's New Folder button; `promptToCreate` is the Windows equivalent.
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked)
    {
      return null;
    }
    else
    {
      return picked;
    }
  });

  handle('file:choosePatch', async (defaultPath, mode) =>
  {
    // Either, since `git am` takes either: a folder of numbered patches is what
    // `format-patch` produces. The viewer passes `'file'`: it reads one patch, and a directory has no contents to show.
    let properties: Array<'openFile' | 'openDirectory'>;
    if (mode === CHOOSE_PATCH_MODE_FILE)
    {
      properties = ['openFile'];
    }
    else
    {
      properties = ['openFile', 'openDirectory'];
    }
    const result = await dialog.showOpenDialog({
      title: 'Choose a Patch',
      defaultPath: defaultPath || app.getPath('home'),
      properties,
      filters: [
        { name: 'Patch files', extensions: ['patch', 'diff', 'mbox'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked)
    {
      return null;
    }
    else
    {
      return picked;
    }
  });

  handle('file:chooseSavePath', async (defaultName, extensions) =>
  {
    // Named after what they are, not "All files": the archive dialog's filter says which format is selected as well as filtering.
    let filters: { name: string; extensions: string[] }[];
    if (extensions.length)
    {
      filters = [{ name: extensions.join(', '), extensions }];
    }
    else
    {
      filters = [];
    }
    const result = await dialog.showSaveDialog({
      title: 'Save As',
      defaultPath: join(app.getPath('downloads'), defaultName),
      filters
    });
    if (result.canceled || !result.filePath)
    {
      return null;
    }
    else
    {
      return result.filePath;
    }
  });

  handle('diff:saveFileAs', async (repoPath, range, file) =>
  {
    // The dialog first, then the read: cancelling is common, and a `git show` of a large blob before that is work thrown away.
    const result = await dialog.showSaveDialog({
      title: 'Save File As',
      defaultPath: join(app.getPath('downloads'), basename(file.path))
    });
    if (result.canceled || !result.filePath)
    {
      return null;
    }

    // The newer end: "save this file as it is here", where *here* is whatever the file list is showing.
    const contents = await readFileAt(repoPath, range.to, file.path);
    await writeFile(result.filePath, contents);
    return result.filePath;
  });


  // ── Conflict resolution ──────────────────────────────────────────────────────
  handle('conflicts:readBlobs', (repoPath, path) => readConflictBlobs(repoPath, path));
  handleWrite('conflicts:writeResolved', ['worktree'], (repoPath, path, text) =>
    writeConflictResolution(repoPath, path, text)
  );
  handle('conflicts:readSides', (repoPath) => resolveConflictSides(repoPath));

}
