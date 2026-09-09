/**
 * The file commands that work today: copying a path, handing the file to the OS, and
 * saving it out. Builds only: `commands/file.ts` declares labels/predicates, this file
 * adds the `run`, split out because these need the stores, which import `renderer/api.ts`
 * (reads `window.git` at import time, so it can't load under Node).
 */

import { implementCommand } from './registry.js';
import type { DiffFileEntry, DiffRange } from '@shared/diff.js';
import { FILE_STATUS_UNCHANGED } from '@shared/types.js';
import { api, toMessage } from '@renderer/api.js';
import { copyText } from '@renderer/clipboard.js';
import { toNativePath } from '@renderer/model/paths.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import { useUiStore } from '@renderer/stores/ui.js';

/** The selected path, repo-relative and POSIX, exactly as git names it: from whichever list the file pane is showing. */
function selectedPath(): string | null
{
  // The commit screen takes the window, so while it's up it's the only list a file command could mean.
  if (useUiStore().commitScreenOpen)
  {
    return useStagingStore().selectedPath;
  }
  if (useSettingsStore().settings.filesPaneMode === FILES_PANE_MODE_TREE)
  {
    return useFileTreeStore().selectedPath;
  }
  else
  {
    return useDiffStore().selectedFile?.path ?? null;
  }
}

/**
 * The selected file as a diff entry, which is what `diff:saveFileAs` reads. A tree
 * entry becomes one with no change to report: the save takes the *newer* end of the
 * range, the revision the tree is of.
 */
interface SaveAsTarget {
  repoPath: string;
  file: DiffFileEntry;
  range: DiffRange;
}

/** The repo/file/range to save from, or null when any is missing. */
function saveAsTargetOf(
  repoPath: string | undefined,
  file: DiffFileEntry | null,
  range: DiffRange | null
): SaveAsTarget | null
{
  if (repoPath && file && range)
  {
    return { repoPath, file, range };
  }
  else
  {
    return null;
  }
}

function selectedEntry(): DiffFileEntry | null
{
  if (useUiStore().commitScreenOpen)
  {
    return useStagingStore().selectedFile;
  }
  if (useSettingsStore().settings.filesPaneMode !== FILES_PANE_MODE_TREE)
  {
    return useDiffStore().selectedFile;
  }
  const entry = useFileTreeStore().selectedEntry;
  if (entry === null)
  {
    return null;
  }
  // `binary` is what a *diff* found; this entry was never diffed, so the blob pane reports it here by reading the file.
  return {
    path: entry.path,
    status: FILE_STATUS_UNCHANGED,
    score: 0,
    kind: entry.kind,
    mode: entry.mode,
    binary: false
  };
}

/** The selected path as the OS spells it. The separator comes from the repository's own path, not a platform check, since the renderer has no `node:path`. */
function selectedNativePath(): string | null
{
  const path = selectedPath();
  const root = useRepoStore().repo?.path;
  if (!path || !root)
  {
    return null;
  }
  return toNativePath(root, path);
}

/**
 * Await a hand-off to the OS, and say so when it refuses.
 *
 * These commands look like they cannot fail, and a file list is exactly where that is
 * untrue: its rows are what some *commit* held, so the path behind one is routinely not
 * in the working tree at all. Left unread the rejection is a click that does nothing,
 * which reads as the app being broken rather than as the file being absent.
 */
async function handToOs(work: Promise<void>): Promise<void>
{
  try
  {
    await work;
  }
  catch (error)
  {
    useUiStore().toast(toMessage(error), 'error');
  }
}

export function registerWorkingFileCommands(): void
{
  implementCommand('file.copyPath', () =>
  {
    const path = selectedPath();
    if (path)
    {
      void copyText(path, 'path');
    }
  });

  implementCommand('file.copyFullPath', () =>
  {
    const path = selectedNativePath();
    if (path)
    {
      void copyText(path, 'full path');
    }
  });

  implementCommand('file.open', () =>
  {
    const path = selectedNativePath();
    // The OS decides what "open" means: the same handler double-clicking the file in Finder would use.
    if (path)
    {
      void handToOs(api['repo:openPath'](path));
    }
  });

  /** The same open, with the application chosen rather than assumed. Built here because it needs a path; what "with" means is `main/ipc`'s business. */
  implementCommand('file.openWith', () =>
  {
    const path = selectedNativePath();
    if (path)
    {
      void api['file:openWith'](path);
    }
  });

  /**
   * Edit the file here rather than handing it to another application. `F4` beside
   * `Shift+F4`'s "open". Repo-relative, not the native path: the main process resolves
   * it inside the working tree, which keeps this from writing anywhere on disk.
   */
  implementCommand('file.editWorkingFile', () =>
  {
    const path = selectedPath();
    if (path)
    {
      useUiStore().openDialog('repo.editFile', { filePath: path });
    }
  });

  implementCommand('file.showInFolder', () =>
  {
    const path = selectedNativePath();
    if (path)
    {
      void handToOs(api['repo:showItemInFolder'](path));
    }
  });

  /** Save the file as it is at the *newer* end of the comparison. The dialog and write are the main process's; the read goes through `git show`, not the disk. */
  implementCommand('file.saveAs', async () =>
  {
    const target = saveAsTargetOf(useRepoStore().repo?.path, selectedEntry(), useDiffStore().range);
    if (!target)
    {
      return;
    }

    const ui = useUiStore();
    try
    {
      const saved = await api['diff:saveFileAs'](target.repoPath, target.range, target.file);
      if (saved)
      {
        ui.toast(`Saved ${saved}`);
      }
    }
    catch (err)
    {
      // Worth saying: a silent failure is indistinguishable from a cancel, and the two mean very different things.
      ui.toast(toMessage(err), 'error');
    }
  });
}
