/**
 * The commit screen's menus. Ids only, resolved against the registry. Three menus for
 * three operands, rather than one forty-row menu:
 *
 * | Surface | Operand | Where |
 * |---|---|---|
 * | `stagingListMenu` | the file you right-clicked | right-click a row |
 * | `stagingListViewMenu` | the list | the `⋯` button in each list's header |
 * | `commitOptionsMenu` | the commit about to be made | the Options button by Commit |
 *
 * Rows written `hideIfUnavailable` leave the menu when they don't apply instead of
 * greying, so Stage is absent from the staged list's menu, Unstage from the unstaged one.
 */

import { hideIfUnavailable, item, operand, separator, submenu, type MenuNode } from './resolve.js';
import { CONVENTIONAL_PREFIXES } from '@renderer/model/commitMessage.js';

/** Right-clicking a row in either list. */
export const stagingListMenu: MenuNode[] = [
  hideIfUnavailable('file.stage'),
  hideIfUnavailable('file.unstage'),
  separator,
  item('file.open'),
  item('file.editWorkingFile'),
  submenu('Open With', [
    item('file.openWith'),
    item('file.openRevision'),
    item('file.openRevisionWith'),
    item('file.openWithDifftool')
  ]),
  separator,
  item('file.saveAs'),
  item('file.showInFolder'),
  item('file.showInFileTree'),
  item('file.copyPath'),
  item('file.copyFullPath'),
  separator,
  submenu('Undo', [
    hideIfUnavailable('file.reset'),
    hideIfUnavailable('file.resetChunk'),
    hideIfUnavailable('file.cherryPickChanges')
  ]),
  hideIfUnavailable('file.move'),
  hideIfUnavailable('file.delete'),
  separator,
  item('file.history'),
  item('file.blame'),
  separator,
  submenu('Ignore', [item('file.ignore'), item('file.exclude')]),
  // The three `update-index` flags. A submenu: they're a set of states of one file, and two of them are the kind of thing you want to find deliberately, not by accident.
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

/** The `⋯` button in each list's header: how the list is shaped and what it shows. */
export const stagingListViewMenu: MenuNode[] = [
  item('staging.viewFlat'),
  item('staging.viewTree'),
  item('staging.groupByExtension'),
  item('staging.groupByStatus'),
  separator,
  item('staging.denseTree'),
  item('staging.toggleFilter'),
  separator,
  item('staging.showUntracked'),
  item('staging.showIgnored'),
  item('staging.showSkipWorktree'),
  item('staging.showAssumeUnchanged'),
  separator,
  item('staging.selectAll'),
  item('staging.refresh')
];

/** What the three data-driven submenus below are built from, read out of the repository rather than declared: see `stores/staging/history.ts`. */
export interface CommitOptionsSources {
  /** Whole messages of recent commits, newest first. */
  recentMessages: readonly string[];
  /** Everyone who authored one, as `Name <email>`. */
  recentAuthors: readonly string[];
}

/** How much of a message a menu row can show before it stops being a row. */
const ROW_MESSAGE_LENGTH = 60;

/** A message's first line, short enough to read at a glance. */
function rowLabel(message: string): string
{
  const first = message.split('\n')[0]!.trim();
  if (first.length <= ROW_MESSAGE_LENGTH)
  {
    return first;
  }
  return `${first.slice(0, ROW_MESSAGE_LENGTH - 1)}…`;
}

/**
 * The Options button beside Commit: what this commit will be, and the ways out. A
 * function, not a constant: three of its rows are *data*, but each is still a registry
 * command with an operand, and each empty submenu greys in place rather than vanishing.
 */
export function commitOptionsMenu(sources: CommitOptionsSources): MenuNode[]
{
  return [
    item('staging.amend'),
    item('staging.noVerify'),
    item('staging.resetAuthor'),
    // The people who have committed here, rather than a box to type an address into: exact, where a mistyped address would be a second identity nothing afterwards notices.
    submenu(
      'Change Author',
      sources.recentAuthors.map((line) => operand('staging.changeAuthor', line, { author: line })),
      { greyWhenEmpty: true }
    ),
    separator,
    submenu(
      'Recent Commit Messages',
      sources.recentMessages.map((message) =>
        operand('staging.recentMessages', rowLabel(message), { text: message })
      ),
      { greyWhenEmpty: true }
    ),
    submenu(
      'Conventional Commit Prefix',
      CONVENTIONAL_PREFIXES.map((entry) =>
        operand('staging.conventionalPrefix', `${entry.type}: ${entry.describes}`, {
          prefix: entry.type
        })
      )
    ),
    item('staging.addSelectionToMessage'),
    separator,
    item('staging.createBranch'),
    item('staging.stageInSuperproject'),
    item('staging.submoduleSummary'),
    separator,
    item('staging.closeWhenDone')
  ];
}

/** The screen's undo cluster. A menu, not four buttons beside Commit: every one of them throws work away, so they're one deliberate click further away here. */
export const commitResetMenu: MenuNode[] = [
  item('staging.stageAll'),
  item('staging.unstageAll'),
  separator,
  item('staging.stashStaged'),
  separator,
  item('staging.resetUnstagedChanges'),
  item('staging.resetAllChanges'),
  item('staging.resetSoft')
];
