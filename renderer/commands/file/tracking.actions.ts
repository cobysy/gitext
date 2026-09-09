/**
 * The file commands that change what git *watches*: an ignore rule, a submodule's own
 * operations, moving or deleting a file, the two index flags that make git pretend a
 * tracked file has not changed, and dropping a file from the index entirely.
 *
 * Imports stores: must NOT be listed in `tsconfig.node.json`.
 */

import { implementCommand } from '../registry.js';
import { api, toMessage } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import { toFilePath } from '@renderer/model/paths.js';
import {
  FILE_STATUS_UNTRACKED
} from '@shared/types.js';
import {
  IGNORE_TARGET_EXCLUDE,
  IGNORE_TARGET_GITIGNORE,
  INDEX_FLAG_ASSUME_UNCHANGED,
  INDEX_FLAG_SKIP_WORKTREE,
  afterChange,
  describe,
  selectedEntries,
  selectedPaths
} from './context.js';

export function implementFileTrackingCommands(): void
{
  /**
   * Both rows open the same window, set to the file the row names. Where the rule
   * goes is a radio in the window, so the two rows differ only in which way it opens.
   */
  const openIgnore = (target: 'gitignore' | 'exclude') => () =>
  {
    const paths = selectedPaths();
    if (paths.length)
    {
      useUiStore().openDialog('file.ignore', { filePaths: paths, ignoreTarget: target });
    }
  };

  implementCommand('file.ignore', openIgnore(IGNORE_TARGET_GITIGNORE));
  implementCommand('file.exclude', openIgnore(IGNORE_TARGET_EXCLUDE));

  /**
   * The submodule rows on the two file menus. A submodule row's operand is a whole
   * other repository, so Update is the superproject's business and the rest are the submodule's own.
   */
  const submodulePath = (): string | undefined => selectedPaths()[0];

  implementCommand('file.submoduleUpdate', () =>
  {
    const path = submodulePath();
    if (path)
    {
      useUiStore().openDialog('submodule.manage', { filePath: path });
    }
  });

  const openSubmoduleFor = (what: string) => async () =>
  {
    const path = submodulePath();
    const repo = useRepoStore().repo;
    if (!path || !repo)
    {
      return;
    }
    const ui = useUiStore();
    if (await useRepoStore().open(`${repo.path}/${path}`))
    {
      ui.toast(`Opened the submodule: ${what} from here.`);
    }
  };

  implementCommand('file.submoduleReset', openSubmoduleFor('reset its changes'));
  implementCommand('file.submoduleStash', openSubmoduleFor('stash its changes'));
  implementCommand('file.submoduleCommit', openSubmoduleFor('commit'));

  implementCommand('file.move', () =>
  {
    const paths = selectedPaths();
    const ui = useUiStore();
    // One at a time: a rename is a new name, and there's no such thing as one new name for five files.
    if (paths.length !== 1)
    {
      ui.toast('Rename acts on one file at a time.', 'info');
      return;
    }
    ui.openDialog('file.move', { filePath: paths[0]! });
  });

  implementCommand('file.delete', async () =>
  {
    const entries = selectedEntries();
    const repo = useRepoStore().repo;
    if (!repo || entries.length === 0)
    {
      return;
    }

    const ui = useUiStore();
    const ok = await ui.confirm({
      title: 'Delete File',
      message: `Delete ${describe(entries.map((e) => e.path))} from the working directory? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok)
    {
      return;
    }

    try
    {
      await api['file:delete'](
        repo.path,
        entries.filter((e) => e.status !== FILE_STATUS_UNTRACKED).map((e) => e.path),
        entries.filter((e) => e.status === FILE_STATUS_UNTRACKED).map((e) => e.path)
      );
      await afterChange();
    }
    catch (err)
    {
      ui.toast(toMessage(err), 'error');
    }
  });

  // ── The index flags ────────────────────────────────────────────────────────

  /**
   * Toggle one of the two `update-index` flags over the selection. A mixed selection
   * turns *on*, the direction that makes the selection consistent: turning off would leave half still marked.
   */
  const setFlag = async (flag: 'skip-worktree' | 'assume-unchanged'): Promise<void> =>
  {
    const repo = useRepoStore().repo;
    const staging = useStagingStore();
    const paths = selectedPaths();
    if (!repo || paths.length === 0)
    {
      return;
    }

    let marked;
    if (flag === INDEX_FLAG_SKIP_WORKTREE)
    {
      marked = staging.skipWorktree;
    }
    else
    {
      marked = staging.assumeUnchanged;
    }
    const on = !paths.every((path) => marked.includes(toFilePath(path)));

    try
    {
      await api['stage:setIndexFlag'](repo.path, paths, flag, on);
      await staging.loadIndexFlags();
      await afterChange();
    }
    catch (err)
    {
      useUiStore().toast(toMessage(err), 'error');
    }
  };

  implementCommand('file.skipWorktree', () => setFlag(INDEX_FLAG_SKIP_WORKTREE));
  implementCommand('file.assumeUnchanged', () => setFlag(INDEX_FLAG_ASSUME_UNCHANGED));

  implementCommand('file.stopTracking', async () =>
  {
    const repo = useRepoStore().repo;
    const paths = selectedPaths();
    if (!repo || paths.length === 0)
    {
      return;
    }

    const ui = useUiStore();
    const ok = await ui.confirm({
      title: 'Stop Tracking',
      message: `Stop tracking ${describe(paths)}? They stay on disk, and the next commit records them as deleted.`,
      confirmLabel: 'Stop Tracking'
    });
    if (!ok)
    {
      return;
    }

    try
    {
      await api['stage:stopTracking'](repo.path, paths);
      await afterChange();
    }
    catch (err)
    {
      ui.toast(toMessage(err), 'error');
    }
  });

}
