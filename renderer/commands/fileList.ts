/**
 * How the changed-files list is shaped (flat/tree/grouped). On the toolbar because which view reads better depends on the diff.
 * Separate from commands/file.ts (operates on the list, not files in it).
 */

import { defineCommand, hasRepo, type CommandContext } from './registry.js';
import { GROUP_VIEW_EXTENSION, GROUP_VIEW_STATUS } from '@renderer/model/fileGroups.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFilePaneStore } from '@renderer/stores/filePane.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import {
  FILE_PANE_VIEW_BLAME,
  FILE_PANE_VIEW_DIFF,
  FILE_PANE_VIEW_FILE,
  useSettingsStore
} from '@renderer/stores/settings.js';

const PANE_MODE_CHANGED = 'changed';
const PANE_MODE_TREE = 'tree';
const LIST_VIEW_TREE = 'tree';
const LIST_VIEW_FLAT = 'flat';
const FILE_SOURCE_WORKING_TREE = 'workingTree';

const inTree = (c: CommandContext): boolean =>
  c.hasRepo && useSettingsStore().settings.fileListView === LIST_VIEW_TREE;

/**
 * A shape with rows that can be folded: the tree's folders, or a grouping's headings.
 *
 * Wider than `inTree` because expanding and collapsing means something under a grouping
 * too; only "dense tree" is about folders specifically.
 */
const hasFoldableRows = (c: CommandContext): boolean =>
  c.hasRepo && useSettingsStore().settings.fileListView !== LIST_VIEW_FLAT;

/**
 * The store behind whichever list the pane is showing.
 *
 * The two hold their own collapsed sets: a whole repository opens collapsed while a
 * commit's handful of files opens flat: so a folder command has to act on the one whose
 * folders are on screen.
 */
function activeList(): { expandAll: () => void; collapseAll: () => void }
{
  if (useSettingsStore().settings.filesPaneMode === PANE_MODE_TREE)
  {
    return useFileTreeStore();
  }
  else
  {
    return useDiffStore();
  }
}

export function registerFileListCommands(): void
{
  // Which question the pane answers. A two-way selector for the same reason as the two
  // below: one setting with two values, each row naming the answer it gives.
  defineCommand({
    id: 'files.viewChanged',
    radioGroup: 'files.source',
    label: 'Changed Files',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().settings.filesPaneMode === PANE_MODE_CHANGED,
    run: () => useSettingsStore().patch({ filesPaneMode: PANE_MODE_CHANGED })
  });

  defineCommand({
    id: 'files.viewRevisionTree',
    radioGroup: 'files.source',
    label: 'File Tree',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().settings.filesPaneMode === PANE_MODE_TREE,
    run: () => useSettingsStore().patch({ filesPaneMode: PANE_MODE_TREE })
  });

  // Second question (independent from the mode above): every combination means something.
  // Labels name the answer ("Diff" alone would be indistinguishable from the Diff menu).
  // Each answers for the list the pane is beside, which is what `setFilePaneView` reads:
  // the tree and the changed list remember their own.
  defineCommand({
    id: 'files.viewDiff',
    radioGroup: 'files.pane',
    label: 'Show the Diff',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().filePaneView === FILE_PANE_VIEW_DIFF,
    run: () => useSettingsStore().setFilePaneView(FILE_PANE_VIEW_DIFF)
  });

  defineCommand({
    id: 'files.viewContents',
    radioGroup: 'files.pane',
    label: 'Show the Whole File',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().filePaneView === FILE_PANE_VIEW_FILE,
    run: () => useSettingsStore().setFilePaneView(FILE_PANE_VIEW_FILE)
  });

  defineCommand({
    id: 'files.viewBlame',
    radioGroup: 'files.pane',
    label: 'Show Who Wrote Each Line',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().filePaneView === FILE_PANE_VIEW_BLAME,
    run: () => useSettingsStore().setFilePaneView(FILE_PANE_VIEW_BLAME)
  });

  // A two-way selector like the grid's branch scope, not two toggles: one setting with
  // two values, each row saying which it is.
  defineCommand({
    id: 'files.viewTree',
    radioGroup: 'files.shape',
    label: 'Group by File Path, Tree',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().settings.fileListView === LIST_VIEW_TREE,
    run: () => useSettingsStore().patch({ fileListView: LIST_VIEW_TREE })
  });

  defineCommand({
    id: 'files.viewFlat',
    radioGroup: 'files.shape',
    label: 'Group by File Path, Flat',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().settings.fileListView === LIST_VIEW_FLAT,
    run: () => useSettingsStore().patch({ fileListView: LIST_VIEW_FLAT })
  });

  // Other shapes (extension/status grouping): values of the same setting (one shape at a time).
  defineCommand({
    id: 'files.groupByExtension',
    radioGroup: 'files.shape',
    label: 'Group by File Extension',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().settings.fileListView === GROUP_VIEW_EXTENSION,
    run: () => useSettingsStore().patch({ fileListView: GROUP_VIEW_EXTENSION })
  });

  defineCommand({
    id: 'files.groupByStatus',
    radioGroup: 'files.shape',
    label: 'Group by File Status',
    group: 'Files',
    when: hasRepo,
    checked: () => useSettingsStore().settings.fileListView === GROUP_VIEW_STATUS,
    run: () => useSettingsStore().patch({ fileListView: GROUP_VIEW_STATUS })
  });

  defineCommand({
    id: 'files.denseTree',
    label: 'Dense Tree',
    group: 'Files',
    when: inTree,
    checked: () => useSettingsStore().settings.fileListDenseTree,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ fileListDenseTree: !settings.settings.fileListDenseTree });
    }
  });

  // Both act on whichever list the pane is showing: the folders on screen are the ones
  // a user means, and the other list's are not visible to disagree with.
  defineCommand({
    id: 'files.expandAll',
    label: 'Expand All Folders',
    group: 'Files',
    when: hasFoldableRows,
    run: () => activeList().expandAll()
  });

  defineCommand({
    id: 'files.collapseAll',
    label: 'Collapse All Folders',
    group: 'Files',
    when: hasFoldableRows,
    run: () => activeList().collapseAll()
  });

  // The pane's one piece of memory, and the only way to undo it: the file it keeps open
  // from one revision to the next. Offered only while there is one, so the row greys out
  // rather than claiming to have done something.
  defineCommand({
    id: 'files.stopFollowing',
    label: 'Stop Following the Open File',
    group: 'Files',
    when: (c) => c.hasRepo && useFilePaneStore().wantedPath !== null,
    run: () => useFilePaneStore().forget()
  });

  // Only the working-tree pivot has ignored files to show: a commit's diff lists what it
  // changed, and nothing git ignores can be in one.
  defineCommand({
    id: 'files.showIgnored',
    label: 'Show Ignored Files',
    group: 'Files',
    when: (c) => c.hasRepo && c.fileSource === FILE_SOURCE_WORKING_TREE,
    checked: () => useSettingsStore().settings.fileListShowIgnored,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ fileListShowIgnored: !settings.settings.fileListShowIgnored });
    }
  });
}
