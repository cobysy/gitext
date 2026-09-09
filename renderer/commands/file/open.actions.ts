/**
 * The file commands that open something rather than change anything: an external diff
 * tool, the file at a revision, the file's history or blame, a search, and the grid
 * filtered to one path.
 *
 * Imports stores: must NOT be listed in `tsconfig.node.json`.
 */

import { implementCommand } from '../registry.js';
import { api, toMessage } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import {
  ENDPOINT_KIND_COMMIT,
  ENDPOINT_KIND_WORKING_TREE,
  type DiffRange
} from '@shared/diff.js';
import {
  APPLICABLE_PATCH,
  FILE_HISTORY_TAB_BLAME,
  FILE_HISTORY_TAB_DIFF,
  RANGE_END_FROM,
  RANGE_END_TO,
  afterChange,
  currentRange,
  onCommitScreen,
  selectedEntries,
  selectedPaths
} from './context.js';
import { fileRangeTargetOf, pathEndpointTargetOf, twoPathsTargetOf } from './targets.js';

export function implementFileOpenCommands(): void
{

  implementCommand('file.openWithDifftool', async () =>
  {
    const target = fileRangeTargetOf(useRepoStore().repo, selectedPaths()[0], currentRange());
    if (!target)
    {
      return;
    }
    try
    {
      await api['file:difftool'](target.repo.path, target.range, target.path);
    }
    catch (err)
    {
      useUiStore().toast(toMessage(err), 'error');
    }
  });

  /**
   * The same difftool run, against the working directory instead of the pivot's far
   * end (`Alt+F3`/`Shift+Alt+F3`): "what's happened since then" without moving the grid's selection.
   */
  const difftoolAgainstWorkingTree = async (which: 'from' | 'to'): Promise<void> =>
  {
    const endpoint = currentRange()?.[which] ?? null;
    const target = pathEndpointTargetOf(useRepoStore().repo, selectedPaths()[0], endpoint);
    if (!target)
    {
      return;
    }
    const against: DiffRange = { from: target.endpoint, to: { kind: ENDPOINT_KIND_WORKING_TREE } };
    try
    {
      await api['file:difftool'](target.repo.path, against, target.path);
    }
    catch (err)
    {
      useUiStore().toast(toMessage(err), 'error');
    }
  };

  implementCommand('file.diffFirstToWorking', () => difftoolAgainstWorkingTree(RANGE_END_FROM));
  implementCommand('file.diffSecondToWorking', () => difftoolAgainstWorkingTree(RANGE_END_TO));

  /**
   * Two picked files against each other, at the revision the pane is showing: the
   * other axis, since every other comparison here is one file across two revisions.
   * Written out as temp files (`file:compareTwo`): git has no way to ask about two paths at a revision.
   */
  implementCommand('file.diffSelected', async () =>
  {
    const target = twoPathsTargetOf(useRepoStore().repo, currentRange()?.to, selectedPaths());
    if (!target)
    {
      return;
    }
    try
    {
      await api['file:compareTwo'](target.repo.path, target.endpoint, target.paths[0], target.paths[1]);
    }
    catch (err)
    {
      useUiStore().toast(toMessage(err), 'error');
    }
  });

  /**
   * Narrow the grid to the commits that touched this file. A toggle, not a one-way
   * trip: bound to a bare `F`, so pressing it on the file already filtering by clears it, same as the grid footer's chip.
   */
  implementCommand('file.filterInGrid', async () =>
  {
    const revisions = useRevisionsStore();
    const paths = selectedPaths();
    if (paths.length === 0)
    {
      return;
    }
    const same =
      revisions.pathFilter.length === paths.length &&
      paths.every((path) => revisions.pathFilter.includes(path));
    let nextFilter: string[];
    if (same)
    {
      nextFilter = [];
    }
    else
    {
      nextFilter = paths;
    }
    await revisions.setPathFilter(nextFilter);
  });

  /**
   * Bring a commit's changes to a file into the working tree, without taking the
   * commit: the mirror of `file.resetChunk`, `git apply` forward over the whole file rather than one hunk.
   *
   * The patch is re-read with git's own defaults, not the viewer's: a diff widened or
   * whitespace-folded is a patch `git apply` rejects.
   */
  implementCommand('file.cherryPickChanges', async () =>
  {
    const repo = useRepoStore().repo;
    const range = currentRange();
    const entries = selectedEntries();
    const ui = useUiStore();
    if (!repo || !range || entries.length === 0)
    {
      return;
    }

    try
    {
      for (const entry of entries)
      {
        const patch = await api['diff:patch'](repo.path, range, entry, APPLICABLE_PATCH);
        if (patch.truncated)
        {
          ui.toast(`${entry.path} is too large to apply as a patch.`, 'error');
          return;
        }
        if (patch.text.trim())
        {
          await api['stage:applyToWorkingTree'](repo.path, patch.text, false);
        }
      }
      await afterChange();
    }
    catch (err)
    {
      ui.toast(toMessage(err), 'error');
    }
  });

  implementCommand('file.openRevisionWith', async () =>
  {
    const target = fileRangeTargetOf(useRepoStore().repo, selectedPaths()[0], currentRange());
    if (!target)
    {
      return;
    }
    try
    {
      await api['file:openRevisionWith'](target.repo.path, target.range.to, target.path);
    }
    catch (err)
    {
      useUiStore().toast(toMessage(err), 'error');
    }
  });

  implementCommand('file.openRevision', async () =>
  {
    const target = fileRangeTargetOf(useRepoStore().repo, selectedPaths()[0], currentRange());
    if (!target)
    {
      return;
    }
    try
    {
      // The newer end, same as Save As: "this revision" means the one the list is showing.
      await api['file:openRevision'](target.repo.path, target.range.to, target.path);
    }
    catch (err)
    {
      useUiStore().toast(toMessage(err), 'error');
    }
  });

  /**
   * Jump from a file to where it sits in the repository's tree. The commit screen has
   * no tree pane, so it relays the jump (`dialog:showInFileTree`) and closes; the changed-files list switches the pane directly.
   */
  implementCommand('file.showInFileTree', () =>
  {
    const path = selectedPaths()[0];
    if (!path)
    {
      return;
    }
    if (onCommitScreen())
    {
      void api['dialog:showInFileTree'](path);
      useUiStore().closeCommitScreen();
      return;
    }
    void useSettingsStore().patch({ filesPaneMode: FILES_PANE_MODE_TREE });
    useDiffStore().select(path);
  });

  /**
   * Search the files of the revision the pane is showing: its operand is the commit,
   * not the clicked file, since `git grep` searches a whole tree. No revision means the
   * working tree, same rule as `file.history`.
   */
  implementCommand('file.findInFiles', () =>
  {
    const to = currentRange()?.to;
    let sha: string | undefined;
    if (to?.kind === ENDPOINT_KIND_COMMIT)
    {
      sha = to.sha;
    }
    else
    {
      sha = undefined;
    }
    useUiStore().openDialog('search.grep', { sha });
  });

  /**
   * `file.history` and `file.blame`: one dialog, opened on its Diff or Blame tab. `sha`
   * is left out when the pivot's newer end isn't a commit, so `readBlame` blames the
   * working tree instead of guessing `HEAD`.
   */
  function openFileHistory(tab: 'diff' | 'blame')
  {
    return (): void =>
    {
      const path = selectedPaths()[0];
      if (!path)
      {
        return;
      }
      const to = currentRange()?.to;
      let sha: string | undefined;
      if (to?.kind === ENDPOINT_KIND_COMMIT)
      {
        sha = to.sha;
      }
      else
      {
        sha = undefined;
      }
      useUiStore().openDialog('file.history', {
        filePath: path,
        sha,
        fileHistoryTab: tab
      });
    };
  }

  implementCommand('file.history', openFileHistory(FILE_HISTORY_TAB_DIFF));
  implementCommand('file.blame', openFileHistory(FILE_HISTORY_TAB_BLAME));
}
