/**
 * The current branch's menu. Two surfaces open it: the branch name in the status bar, and
 * the toolbar's branch button.
 *
 * **It leads with the branches you can switch to**, because that is what the control it
 * hangs off looks like it does. A button reading `master` with a caret is a picker
 * everywhere else a person has used one, and a menu of operations behind it answers a
 * question nobody asked. The operations stay, under the list, where they read as "and
 * these are the other things you can do to it".
 *
 * Below the list, two rules decide what belongs.
 *
 * **Its operand is HEAD.** A command taking the grid's selected commit is wrong here
 * however well its label reads: `branch.merge` is "Merge This Commit into Current Branch…"
 * and `ref.push` is "Push This Branch…", meaning the panel's row, and neither is a thing
 * you asked for by pressing a button that names the branch you are on. So the rest is the
 * `hasRepo` set only, which stays clickable with nothing selected anywhere.
 *
 * **It does not repeat a control standing beside it.** Push and Pull were here and are
 * not: both surfaces that open this menu have buttons for them within a few pixels, the
 * toolbar's pair and the status bar's arrows. A menu row whose job is already done by
 * something visible next to it costs a line and teaches nothing.
 */

import { item, operand, separator, type MenuNode } from './resolve.js';

/** What the menu needs of a branch: everything else about a ref is the panel's business. */
export interface BranchChoice {
  name: string;
  isCurrent: boolean;
  /** Commit date in unix seconds, which is what "the ones you have been working on" means. */
  date: number;
}

/**
 * How many branches the list will show. Past this the full picker is the honest answer: a
 * menu is something you aim at, and a repository with ninety branches would make this one
 * a list you scroll and read, which `branch.checkout` already does better and with a
 * filter box.
 */
export const BRANCH_LIST_LIMIT = 8;

/** Most recently committed first: a branch list in name order buries what you are working on. */
export function branchChoices(branches: readonly BranchChoice[]): BranchChoice[]
{
  return [...branches]
    .filter((entry) => !entry.isCurrent)
    .sort((a, b) => b.date - a.date)
    .slice(0, BRANCH_LIST_LIMIT);
}

export function currentBranchMenu(branches: readonly BranchChoice[] = []): MenuNode[]
{
  const rows: MenuNode[] = [];

  // The branch you are on is not offered: the button already names it, and checking it
  // out again does nothing.
  for (const entry of branchChoices(branches))
  {
    rows.push(operand('revision.checkoutBranchHere', entry.name, { ref: entry.name }));
  }
  if (rows.length > 0)
  {
    rows.push(separator);
  }

  // Every branch, remote ones included, with a filter box: what the list above is a
  // shortcut past rather than a replacement for.
  rows.push(item('branch.checkout'));
  rows.push(separator);
  rows.push(item('branch.rebaseAdvanced'));
  rows.push(item('branch.delete'));

  return rows;
}
