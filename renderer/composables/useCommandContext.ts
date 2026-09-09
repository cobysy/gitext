/**
 * Live CommandContext built from stores. Split from useCommands.ts for interface segregation.
 * Callers need context, not keydown listeners or menu dispatch.
 */

import { computed, type ComputedRef } from 'vue';
import type { CommandContext } from '@renderer/commands/registry.js';
import { isArtificialSha } from '@shared/artificial.js';
import {
  ENDPOINT_KIND_COMMIT,
  ENDPOINT_KIND_INDEX,
  ENDPOINT_KIND_WORKING_TREE,
  type DiffEndpoint
} from '@shared/diff.js';
import { FILE_STATUS_UNCHANGED } from '@shared/types.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { STAGING_SIDE_STAGED, useStagingStore } from '@renderer/stores/staging.js';
import { useUiStore } from '@renderer/stores/ui.js';

const TREE_ENTRY_KIND_SUBMODULE = 'submodule';

/** The pivot's newer end, as the thing the list is a list of. */
function sourceOf(endpoint: DiffEndpoint | null): CommandContext['fileSource']
{
  if (endpoint === null)
  {
    return null;
  }
  if (endpoint.kind === ENDPOINT_KIND_COMMIT)
  {
    return ENDPOINT_KIND_COMMIT;
  }
  else
  {
    return endpoint.kind;
  }
}

export function useCommandContext(): ComputedRef<CommandContext>
{
  const repoStore = useRepoStore();
  const selection = useSelectionStore();
  const objects = useRepoObjectsStore();
  const diff = useDiffStore();
  const fileTree = useFileTreeStore();
  const settings = useSettingsStore();
  const staging = useStagingStore();
  const ui = useUiStore();

  return computed<CommandContext>(() =>
  {
    const node = objects.selected;
    // The commit screen owns the selection while it is up: it takes the window, so the
    // file pane behind it is not what a file command could possibly mean.
    const onCommitScreen = ui.commitScreenOpen;
    // Whichever list the file pane is showing owns the selected file: the file commands
    // act on what is highlighted, and only one of the two lists is on screen. A tree entry
    // is not a change, which is what `unchanged` says.
    let file;
    if (onCommitScreen)
    {
      file = staging.selectedFile;
    }
    else if (settings.settings.filesPaneMode === FILES_PANE_MODE_TREE)
    {
      file = fileTree.selectedEntry && {
        status: FILE_STATUS_UNCHANGED,
        isSubmodule: fileTree.selectedEntry.kind === TREE_ENTRY_KIND_SUBMODULE
      };
    }
    else
    {
      file = diff.selectedFile;
    }
    // Only what a predicate reads. The node itself stays in the store, so a
    // predicate cannot come to depend on the whole tree being walked per keystroke.
    let selectedNode: CommandContext['selectedNode'];
    if (node)
    {
      selectedNode = {
        kind: node.kind,
        isCurrent: node.isCurrent === true,
        isDisabled: node.isDisabled === true
      };
    }
    else
    {
      selectedNode = null;
    }

    // The status alone, for the same reason: what a file command asks is what kind of
    // change it is, not which file it is.
    // The status, and whether it is a gitlink: a submodule row looks like a file and
    // none of the four submodule commands means anything on one that is not.
    let selectedFile: CommandContext['selectedFile'];
    if (file)
    {
      let isSubmodule: boolean;
      if ('isSubmodule' in file)
      {
        isSubmodule = file.isSubmodule === true;
      }
      else
      {
        isSubmodule = file.kind === TREE_ENTRY_KIND_SUBMODULE;
      }
      selectedFile = { status: file.status, isSubmodule };
    }
    else
    {
      selectedFile = null;
    }

    // Which of git's three copies the list in front is showing. The commit screen's two
    // lists *are* the first two, one each; everywhere else it is the newer end of the
    // pivot, which the file tree derives from as well: a tree of the working-tree row
    // is the working tree, and staging out of it is as meaningful as from the list.
    let fileSource: CommandContext['fileSource'];
    if (onCommitScreen)
    {
      if (staging.side === STAGING_SIDE_STAGED)
      {
        fileSource = ENDPOINT_KIND_INDEX;
      }
      else
      {
        fileSource = ENDPOINT_KIND_WORKING_TREE;
      }
    }
    else
    {
      fileSource = sourceOf(diff.range?.to ?? null);
    }

    // The file pane's own count, whichever list it is showing. Zero behind the commit
    // screen, which owns the selection while it is up.
    let fileSelectionCount: number;
    if (onCommitScreen)
    {
      fileSelectionCount = 0;
    }
    else if (settings.settings.filesPaneMode === FILES_PANE_MODE_TREE)
    {
      fileSelectionCount = fileTree.selectedPaths.length;
    }
    else
    {
      fileSelectionCount = diff.selectedPaths.length;
    }

    // The commit screen takes the window, so while it is up the keyboard is in it
    // whatever the pane behind it last reported.
    let focusedPane: CommandContext['focusedPane'];
    if (onCommitScreen)
    {
      focusedPane = 'commitScreen';
    }
    else
    {
      focusedPane = ui.focusedPane;
    }

    let stagingSide: CommandContext['stagingSide'];
    if (onCommitScreen)
    {
      stagingSide = staging.side;
    }
    else
    {
      stagingSide = null;
    }

    let stagingSelectionCount: number;
    if (onCommitScreen)
    {
      stagingSelectionCount = staging.selectedPaths.length;
    }
    else
    {
      stagingSelectionCount = 0;
    }

    return {
      hasRepo: repoStore.isOpen,
      hasSuperproject: Boolean(repoStore.repo?.superprojectPath),
      isMidOperation: repoStore.isMidOperation,
      hasChanges: repoStore.changedFileCount > 0,
      selectionCount: selection.count,
      // `ordered`, not the grid rows: this runs on every keystroke through the hotkey
      // handler, and the selection is a handful of SHAs where the history is thousands.
      hasArtificialSelection: selection.ordered.some(isArtificialSha),
      selectedNode,
      selectedFile,
      fileSource,
      fileSelectionCount,
      focusedPane,
      stagingSide,
      stagingSelectionCount
    };
  });
}
