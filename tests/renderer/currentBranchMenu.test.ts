/**
 * The current branch's menu, which the status bar's branch name and the toolbar's branch
 * button both open.
 *
 * It was a menu of operations, and the control it hangs off is a button reading `master`
 * with a caret: which is a picker everywhere anyone has used one. Someone opened it looking
 * for their branches and got Push, Pull and Rebase. So the rule under test is that the
 * branches come first, and the arithmetic that decides which ones.
 */

import { describe, expect, it } from 'vitest';
import {
  branchChoices,
  currentBranchMenu,
  BRANCH_LIST_LIMIT,
  type BranchChoice
} from '@renderer/menus/currentBranch.js';
import { mainToolbar } from '@renderer/menus/toolbar.js';

const branch = (name: string, date: number, isCurrent = false): BranchChoice => ({
  name,
  date,
  isCurrent
});

const rowsOf = (menu: ReturnType<typeof currentBranchMenu>): string[] =>
  menu.filter((node) => node.kind === 'command').map((node) => node.id);

describe('branchChoices', () =>
{
  it('leaves out the branch you are on', () =>
  {
    // The button already names it, and checking it out again does nothing.
    const chosen = branchChoices([branch('main', 3, true), branch('topic', 2)]);
    expect(chosen.map((entry) => entry.name)).toEqual(['topic']);
  });

  it('puts the most recently committed first', () =>
  {
    // Alphabetical buries whatever is being worked on under whatever starts with an `a`.
    const chosen = branchChoices([branch('a', 1), branch('z', 9), branch('m', 5)]);
    expect(chosen.map((entry) => entry.name)).toEqual(['z', 'm', 'a']);
  });

  it('stops at a length the eye can take in', () =>
  {
    const many = Array.from({ length: 40 }, (_, index) => branch(`b${index}`, index));
    expect(branchChoices(many)).toHaveLength(BRANCH_LIST_LIMIT);
  });

  it('does not reorder the list it was given', () =>
  {
    // Sorting in place would reorder the store's own refs, and the left panel reads them.
    const given = [branch('a', 1), branch('z', 9)];
    branchChoices(given);
    expect(given.map((entry) => entry.name)).toEqual(['a', 'z']);
  });
});

describe('currentBranchMenu', () =>
{
  it('leads with the branches, before anything you can do to one', () =>
  {
    const menu = currentBranchMenu([branch('main', 3, true), branch('topic', 2)]);
    const ids = rowsOf(menu);
    expect(ids[0]).toBe('revision.checkoutBranchHere');
    // Every operation sits after every branch: the list is what the control is for.
    const lastBranch = ids.lastIndexOf('revision.checkoutBranchHere');
    const firstAction = ids.findIndex((id) => id !== 'revision.checkoutBranchHere');
    expect(lastBranch).toBeLessThan(firstAction);
  });

  it('gives each branch row its own ref to check out', () =>
  {
    // Without the operand the command falls back to the grid's selection, which is not
    // the row that was clicked.
    const menu = currentBranchMenu([branch('main', 3, true), branch('topic', 2)]);
    const row = menu.find((node) => node.kind === 'command');
    expect(row).toMatchObject({ label: 'topic', options: { ref: 'topic' } });
  });

  it('still offers the full picker, which has the remote branches and a filter', () =>
  {
    // The list is a shortcut past that dialog, not a replacement for it: a repository with
    // ninety branches shows eight here.
    expect(rowsOf(currentBranchMenu([]))).toContain('branch.checkout');
  });

  it('is all operations when there is nothing to switch to', () =>
  {
    // A fresh repository with one branch: no list, and no separator hanging above nothing.
    const menu = currentBranchMenu([branch('main', 1, true)]);
    expect(rowsOf(menu)).not.toContain('revision.checkoutBranchHere');
    expect(menu[0]?.kind).toBe('command');
  });

  it('repeats no button standing beside it', () =>
  {
    // Push and Pull were on this menu, and both surfaces that open it have buttons for
    // them a few pixels away: the toolbar's pair, and the status bar's arrows. A row whose
    // job is already done by something visible next to it costs a line and teaches nothing.
    const ids = rowsOf(currentBranchMenu([branch('main', 1, true), branch('topic', 2)]));
    const toolbarButtons = mainToolbar()
      .filter((node) => node.kind === 'button')
      .map((node) => node.id);

    expect(toolbarButtons).toContain('remote.push');
    expect(ids.filter((id) => toolbarButtons.includes(id))).toEqual([]);
  });

  it('takes no operand that belongs to another surface', () =>
  {
    // `branch.merge` reads "Merge This Commit…" and `ref.push` reads "Push This Branch…",
    // meaning the grid's row and the panel's: neither is what this button names.
    const ids = rowsOf(currentBranchMenu([branch('main', 1, true), branch('topic', 2)]));
    expect(ids).not.toContain('branch.merge');
    expect(ids).not.toContain('ref.push');
    expect(ids).not.toContain('ref.setUpstream');
  });
});
