/**
 * The left panel's context menus: one per node kind. Ids and structure only, resolved
 * against the registry. `menuFor` is the whole public surface: the panel hands it a
 * node kind and gets a menu, so nothing in the component decides what a branch can do.
 */

import { KIND_SECTION, type PanelNodeKind } from '@renderer/panel.js';
import { hideIfUnavailable, item, separator, type MenuNode } from './resolve.js';

/**
 * Arranging the panel, on every menu, not just section headers, so these rows aren't
 * findable only after right-clicking one specific row. Moving a section is two plain
 * rows, not a submenu, since they act on the row right-clicked. Sorting isn't here: see `panelSortMenu`.
 */
const arrangeMenu: MenuNode[] = [
  // Its own group: everything above acts on the row you clicked, everything here acts on
  // the panel around it, and running them together read as one list of things to do to a
  // branch.
  separator,
  item('panel.moveSectionUp'),
  item('panel.moveSectionDown'),
  item('panel.expandAll'),
  item('panel.collapseAll')
];

/**
 * The panel's sort order: the sort button in the filter row, and nowhere else. Not on
 * the node menus: a context menu is about the row clicked, and "Sort" on a branch's
 * menu would read as something that happens to that branch. The palette still carries
 * these, which is why their labels say "Sort by" rather than just "Name (A-Z)".
 */
export const panelSortMenu: MenuNode[] = [
  item('panel.sortNameAsc'),
  item('panel.sortNameDesc'),
  separator,
  item('panel.sortNewestFirst'),
  item('panel.sortOldestFirst')
];

/** Shared by branch, remote-branch and tag nodes: everything that names a commit. */
const refActions: MenuNode[] = [
  item('ref.checkout'),
  item('ref.merge'),
  item('ref.rebaseCurrentOn'),
  item('ref.resetCurrentTo'),
  item('ref.resetOtherBranchTo'),
  separator,
  item('ref.createBranch'),
  item('ref.compareToCurrent'),
  item('ref.filterGrid')
];

const branchMenu: MenuNode[] = [
  ...refActions,
  separator,
  item('ref.push'),
  item('ref.setUpstream'),
  item('ref.rename'),
  item('ref.delete'),
  separator,
  item('panel.copyName'),
  ...arrangeMenu
];

const remoteBranchMenu: MenuNode[] = [
  ...refActions,
  separator,
  // The fetch-and-then-something group: what a remote branch is really for.
  item('remoteBranch.fetch'),
  item('remoteBranch.fetchCheckout'),
  item('remoteBranch.pull'),
  item('remoteBranch.fetchRebase'),
  item('remoteBranch.fetchCreateBranch'),
  separator,
  item('remoteBranch.delete'),
  separator,
  item('panel.copyName'),
  ...arrangeMenu
];

const tagMenu: MenuNode[] = [
  ...refActions,
  separator,
  item('tag.push'),
  item('ref.delete'),
  separator,
  item('panel.copyName'),
  ...arrangeMenu
];

const remoteMenu: MenuNode[] = [
  item('remote.fetch'),
  item('remote.fetchPrune'),
  separator,
  // Hidden rather than greyed, like the staging list's Stage/Unstage pair: two directions of one switch, so only the one matching the current state means anything.
  hideIfUnavailable('remote.enable'),
  hideIfUnavailable('remote.enableAndFetch'),
  hideIfUnavailable('remote.disable'),
  separator,
  item('remote.openUrl'),
  item('panel.copyUrl'),
  item('panel.copyName'),
  separator,
  item('remote.deleteBranches'),
  item('remote.manage'),
  ...arrangeMenu
];

const stashMenu: MenuNode[] = [
  item('stash.open'),
  item('stash.apply'),
  item('stash.pop'),
  item('stash.drop'),
  separator,
  item('panel.copyName'),
  item('stash.manage'),
  ...arrangeMenu
];

const submoduleMenu: MenuNode[] = [
  item('submodule.open'),
  item('submodule.openInNewWindow'),
  separator,
  item('submodule.update'),
  item('submodule.sync'),
  separator,
  item('submodule.commit'),
  item('submodule.stash'),
  item('submodule.reset'),
  separator,
  item('panel.copyPath'),
  item('panel.showInFinder'),
  item('submodule.manage'),
  ...arrangeMenu
];

const worktreeMenu: MenuNode[] = [
  item('worktree.open'),
  item('worktree.delete'),
  separator,
  item('panel.copyPath'),
  item('panel.showInFinder'),
  separator,
  item('worktree.create'),
  item('worktree.manage'),
  ...arrangeMenu
];

/** A section header's menu: what can be created in it, then the arrangement. One map, not six near-identical exports: the shape is the same, the difference is three ids. */
const sectionMenus: Record<string, MenuNode[]> = {
  'section:branches': [
    item('branch.create'),
    item('branch.checkout'),
    separator,
    ...arrangeMenu
  ],
  'section:remotes': [
    item('remote.fetchAll'),
    item('remote.manage'),
    separator,
    ...arrangeMenu
  ],
  'section:worktrees': [
    item('worktree.create'),
    item('worktree.manage'),
    separator,
    ...arrangeMenu
  ],
  'section:tags': [item('tag.create'), separator, ...arrangeMenu],
  'section:submodules': [
    item('submodule.updateAll'),
    item('submodule.sync'),
    item('submodule.manage'),
    separator,
    ...arrangeMenu
  ],
  'section:stashes': [
    item('stash.save'),
    item('stash.manage'),
    separator,
    ...arrangeMenu
  ]
};

const kindMenus: Record<Exclude<PanelNodeKind, 'section'>, MenuNode[]> = {
  folder: arrangeMenu,
  branch: branchMenu,
  remote: remoteMenu,
  remoteBranch: remoteBranchMenu,
  tag: tagMenu,
  stash: stashMenu,
  submodule: submoduleMenu,
  worktree: worktreeMenu
};

/** The menu for a node. Sections differ by *which* section, so they're looked up by node id; everything else differs only by kind. An unknown section falls back to the arrangement menu. */
export function menuFor(kind: PanelNodeKind, nodeId: string): MenuNode[]
{
  if (kind === KIND_SECTION)
  {
    return sectionMenus[nodeId] ?? arrangeMenu;
  }
  return kindMenus[kind];
}

/** The menu for the panel's empty space, below the last row. */
export const panelBackgroundMenu: MenuNode[] = arrangeMenu;
