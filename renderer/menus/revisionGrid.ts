/**
 * Structure only; labels and rules from the registry.
 * One level deep: daily operations only. Everything else on its own surface.
 */

import type { CheckoutRow } from '@renderer/model/checkoutRows.js';
import { copyMenu } from './copy.js';
import { item, operand, separator, submenu, type MenuNode } from './resolve.js';

/**
 * The working-tree and index rows' menu.
 *
 * A separate menu because the grid's own is about a commit, and these two rows are not one
 * yet: every command in `revisionGridMenu` takes a revision, so right-clicking here
 * resolved thirteen rows and greyed all of them. A menu that can say nothing is worse than
 * no menu, since it looks like the app is broken rather than like the row is different.
 *
 * What is on it is what you do with changes you have not committed.
 */
export const workingDirectoryMenu: MenuNode[] = [
  item('commit.open'),
  separator,
  item('stash.save'),
  separator,
  item('reset.changes'),
  item('workdir.clean'),
  separator,
  item('conflicts.resolve')
];

/**
 * Function not constant: first entry is dynamic (branches on this commit).
 */
export function revisionGridMenu(checkoutRows: readonly CheckoutRow[] = []): MenuNode[]
{
  return [
  // Both checkouts: branch (common) and detached HEAD (rarer, but both needed).
  // Submenu of this commit's branches, not a picker that would re-ask an answered question.
    submenu(
      'Checkout Branch',
      checkoutRows.map((row) =>
        operand('revision.checkoutBranchHere', row.ref, { ref: row.ref, remote: row.remote })
      ),
      { greyWhenEmpty: true }
    ),
    item('commit.checkout'),
    item('branch.create'),
    item('tag.create'),
    separator,
    item('branch.merge'),
    // Three entries rather than one dialog with a mode: the plain one is a keystroke,
    // the other two are a decision.
    submenu('Rebase Current Branch on', [
      item('branch.rebase'),
      item('branch.rebaseInteractive'),
      item('branch.rebaseAdvanced')
    ]),
    item('reset.currentBranch'),
    // Beside it rather than in a submenu: they are the same gesture, right-click a commit,
    // move a branch to it, and which branch is the only thing that differs.
    item('reset.anotherBranch'),
    separator,
    item('commit.cherryPick'),
    item('commit.revert'),
    // Only place with a selected commit SHA; you archive *this* one having found it.
    item('commit.archive'),
    // Other autosquash entries (fixup, squash, amend) need a follow-up rebase; they're cut not hidden.
    item('commit.reword'),
    separator,
    item('compare.withCurrent'),
    item('compare.selected'),
    // With comparisons: both read the commit, not change the repository. Only place to search unchecked-out revisions.
    item('search.grepCommit'),
    separator,
    // A submenu, not six rows: the menu is one level deep for what you *do* to a commit,
    // and copying a field off it is one gesture with six answers.
    submenu('Copy', copyMenu)
  ];
}
