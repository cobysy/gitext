/**
 * The file commands that change what git has: staging a selection, unstaging it, and
 * putting a file, a range's end, or one chunk back to how a revision has it.
 *
 * Every one acts on the *selection*, not one file: a menu row that silently acted on
 * one of five picked files would be worse than one that was greyed.
 *
 * Imports stores: must NOT be listed in `tsconfig.node.json`.
 */

import { implementCommand } from '../registry.js';
import { api, toMessage } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import { buildHunkPatch } from '@renderer/model/stagePatch.js';
import {
  ENDPOINT_KIND_COMMIT,
  ENDPOINT_KIND_WORKING_TREE,
  PATH_SEPARATOR,
  type DiffEndpoint
} from '@shared/diff.js';
import { STAGING, WORKING_TREE } from '@shared/invalidation.js';
import {
  FILE_STATUS_UNTRACKED
} from '@shared/types.js';
import { HEAD_REF } from '@renderer/model/sha.js';
import {
  CMD_ADD,
  CMD_CHECKOUT,
  CMD_RESET,
  RANGE_END_FROM,
  RANGE_END_TO,
  STAGE_DIRECTION_STAGE,
  afterChange,
  currentRange,
  describe,
  onCommitScreen,
  run,
  selectedEntries,
  selectedPaths
} from './context.js';
import { chunkTargetOf } from './targets.js';

export function implementFileChangeCommands(): void
{
  implementCommand('file.stage', async () =>
  {
    const paths = selectedPaths();
    if (paths.length)
    {
      await run([CMD_ADD, PATH_SEPARATOR, ...paths], STAGING);
    }
  });

  implementCommand('file.unstage', async () =>
  {
    const paths = selectedPaths();
    if (paths.length)
    {
      await run([CMD_RESET, HEAD_REF, PATH_SEPARATOR, ...paths], STAGING);
    }
  });

  /**
   * Put the selection back to how some revision has it. `source` is what the file is
   * checked out *from*: `HEAD` for the plain reset, or either end of the pivot for "Reset file(s) to".
   */
  const resetTo = async (source: string | null, label: string): Promise<void> =>
  {
    const entries = selectedEntries();
    if (entries.length === 0)
    {
      return;
    }
    const ui = useUiStore();

    const ok = await ui.confirm({
      title: 'Reset File Changes',
      message: `Put ${describe(entries.map((e) => e.path))} back to ${label}? Changes since then are discarded, and this cannot be undone.`,
      confirmLabel: 'Discard Changes',
      danger: true
    });
    if (!ok)
    {
      return;
    }

    // An untracked file has nothing to check out: discarding it means deleting it, which `git checkout` won't do.
    const tracked = entries.filter((e) => e.status !== FILE_STATUS_UNTRACKED).map((e) => e.path);
    const untracked = entries.filter((e) => e.status === FILE_STATUS_UNTRACKED).map((e) => e.path);
    // No source is git's way of saying "from the index": `git checkout -- <path>`.
    if (tracked.length)
    {
      const sourceArgs: string[] = [];
      if (source !== null)
      {
        sourceArgs.push(source);
      }
      await run([CMD_CHECKOUT, ...sourceArgs, PATH_SEPARATOR, ...tracked], WORKING_TREE);
    }
    if (untracked.length)
    {
      const repo = useRepoStore().repo;
      if (!repo)
      {
        return;
      }
      try
      {
        await api['file:delete'](repo.path, [], untracked);
        await afterChange();
      }
      catch (err)
      {
        ui.toast(toMessage(err), 'error');
      }
    }
  };

  implementCommand('file.reset', () => resetTo(HEAD_REF, 'the last commit'));

  /**
   * The two ends of the pivot, as reset targets: resetting "to first" while reading a
   * commit restores the file as it was *before* it. An artificial endpoint degrades to the nearest thing git accepts.
   */
  const endpointRef = (endpoint: DiffEndpoint | null): string | null =>
  {
    if (endpoint === null)
    {
      return HEAD_REF;
    }
    if (endpoint.kind === ENDPOINT_KIND_COMMIT)
    {
      return endpoint.sha;
    }
    // The working tree isn't a revision anything restores *from*; the index is
    // closest, and `checkout --` is how git spells that.
    if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
    {
      return null;
    }
    else
    {
      return HEAD_REF;
    }
  };

  const describeEnd = (endpoint: DiffEndpoint | null): string =>
  {
    if (endpoint === null)
    {
      return 'the last commit';
    }
    if (endpoint.kind === ENDPOINT_KIND_COMMIT)
    {
      return `\`${endpoint.sha.slice(0, 7)}\``;
    }
    if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
    {
      return 'the index';
    }
    else
    {
      return 'the last commit';
    }
  };

  const resetToEnd = async (which: 'from' | 'to'): Promise<void> =>
  {
    const range = currentRange();
    const endpoint = range?.[which] ?? null;
    await resetTo(endpointRef(endpoint), describeEnd(endpoint));
  };

  implementCommand('file.resetToParent', () => resetToEnd(RANGE_END_FROM));
  implementCommand('file.resetToSelected', () => resetToEnd(RANGE_END_TO));

  /**
   * Undo one hunk on disk, leaving the rest of the file's changes alone. The same
   * patch builder the staging buttons use, reverse-applied to the working tree rather than the index.
   */
  implementCommand('file.resetChunk', async () =>
  {
    const ui = useUiStore();
    const staging = useStagingStore();
    // The patch and file together, never the selection, which may have moved on while a read was in flight.
    const chunkTarget = chunkTargetOf(
      useRepoStore().repo,
      onCommitScreen(),
      staging.patchFile,
      staging.patchTarget
    );

    if (!chunkTarget)
    {
      ui.toast('Open the commit screen and pick a hunk to reset.', 'info');
      return;
    }
    const { repo, file, target } = chunkTarget;
    const hunk = file.hunks[staging.focusedHunk];
    if (!hunk)
    {
      ui.toast('Pick a hunk in the diff first.', 'info');
      return;
    }

    const ok = await ui.confirm({
      title: 'Reset Chunk',
      message: `Discard this hunk of \`${target.path}\` from the working tree? This cannot be undone.`,
      confirmLabel: 'Discard Hunk',
      danger: true
    });
    if (!ok)
    {
      return;
    }

    // Built in the staging direction and reversed on application: undoing puts the index's lines back.
    const patch = buildHunkPatch(file, hunk, { direction: STAGE_DIRECTION_STAGE });
    if (!patch)
    {
      return;
    }
    try
    {
      await api['stage:applyToWorkingTree'](repo.path, patch, true);
      await afterChange();
    }
    catch (err)
    {
      ui.toast(toMessage(err), 'error');
    }
  });
}
