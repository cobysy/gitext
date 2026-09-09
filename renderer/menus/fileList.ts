/**
 * The changed-files list's context menu. Ids only, resolved against the registry. The
 * top level keeps what a changed file is right-clicked *for*, with the two list-shaped
 * clusters in submenus to stay scannable. Index flags and submodule actions are here as
 * well as on the commit screen, since this pane's pivot is the working tree as often as
 * two commits. Rows written `hideIfUnavailable` are the exception: over a file read out
 * of a commit their operand doesn't exist, so they leave rather than grey.
 */

import { hideIfUnavailable, item, separator, submenu, type MenuNode } from './resolve.js';

export const fileListMenu: MenuNode[] = [
  item('file.open'),
  item('file.editWorkingFile'),
  submenu('Open With', [
    item('file.openWith'),
    item('file.openRevision'),
    item('file.openRevisionWith')
  ]),
  // The pivot has two ends here, unlike the commit screen's, so only this pane can offer a difftool run against each of them.
  submenu('Compare', [
    item('file.openWithDifftool'),
    item('file.diffFirstToWorking'),
    item('file.diffSecondToWorking'),
    separator,
    item('file.diffSelected')
  ]),
  separator,
  item('file.saveAs'),
  item('file.showInFolder'),
  item('file.showInFileTree'),
  item('file.copyPath'),
  item('file.copyFullPath'),
  separator,
  hideIfUnavailable('file.stage'),
  hideIfUnavailable('file.unstage'),
  submenu('Undo Changes', [
    item('file.resetToParent'),
    item('file.resetToSelected'),
    hideIfUnavailable('file.resetChunk'),
    hideIfUnavailable('file.cherryPickChanges')
  ]),
  separator,
  item('file.history'),
  item('file.blame'),
  item('file.filterInGrid'),
  separator,
  hideIfUnavailable('file.move'),
  hideIfUnavailable('file.delete'),
  submenu('Ignore', [item('file.ignore'), item('file.exclude')]),
  submenu('Tracking', [
    item('file.skipWorktree'),
    item('file.assumeUnchanged'),
    item('file.stopTracking')
  ]),
  submenu('Submodule', [
    item('file.submoduleUpdate'),
    item('file.submoduleReset'),
    item('file.submoduleStash'),
    item('file.submoduleCommit')
  ])
];

/**
 * The two things the pane can be a list of, drawn as a switch in its header. A menu
 * declaration, not two hardcoded buttons, so the labels are the registry's like every
 * other surface. Also listed in the view menu below, since a header control is only findable if you look at the header.
 */
export const filesPaneModeMenu: MenuNode[] = [
  item('files.viewChanged'),
  item('files.viewRevisionTree')
];

/**
 * The two things the *pane beside* the list can show, drawn as the same kind of switch.
 * A separate declaration from `filesPaneModeMenu`: a separate question (which list vs.
 * what to know about the pick), rendered in a different header.
 */
export const filePaneViewMenu: MenuNode[] = [
  item('files.viewDiff'),
  item('files.viewContents')
];

/** The file list's own view button: how the list is shaped, not what's in it. Its own menu, not rows on the context menu above, since these act on the list, not the file clicked. */
export const fileListViewMenu: MenuNode[] = [
  item('files.viewChanged'),
  item('files.viewRevisionTree'),
  separator,
  item('files.viewDiff'),
  item('files.viewContents'),
  separator,
  item('files.viewTree'),
  item('files.viewFlat'),
  item('files.groupByExtension'),
  item('files.groupByStatus'),
  separator,
  item('files.denseTree'),
  item('files.showIgnored'),
  separator,
  item('files.expandAll'),
  item('files.collapseAll'),
  separator,
  item('files.stopFollowing')
];

/** The diff pane's own options button. A menu, not toggle buttons: five states and two steps, and the left panel's sort button already set the precedent for this shape. */
export const diffOptionsMenu: MenuNode[] = [
  item('diff.inline'),
  item('diff.sideBySide'),
  separator,
  item('diff.showEntireFile'),
  item('diff.moreContext'),
  item('diff.lessContext'),
  separator,
  // What counts as a change, which is the same kind of question as how much of the file to
  // show: three states, so three rows rather than a checkbox that can only say one of them.
  item('diff.showWhitespace'),
  item('diff.ignoreWhitespaceChange'),
  item('diff.ignoreAllWhitespace'),
  separator,
  // Hands the same comparison to the tool git is configured with. It belongs to the pane
  // showing the diff, not to the file list: the file list has its own difftool rows for
  // each end of the pivot.
  item('diff.openInDifftool')
];
