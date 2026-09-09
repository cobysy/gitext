/**
 * Everything the revision-grid context menu can do to a commit. All declared, none
 * built here, so the menu shows its true shape from day one, greying what's not ready.
 * Building calls `implementCommand(id, run)` in `commands/revision.actions.ts`, which
 * imports stores: this file must not.
 */

import { declareCommand, hasRepo, type CommandContext } from './registry.js';
import { KIND_STASH } from '@renderer/panel.js';

const oneCommit = (c: CommandContext): boolean =>
  c.hasRepo && c.selectionCount === 1 && !c.hasArtificialSelection;

const anyCommits = (c: CommandContext): boolean =>
  c.hasRepo && c.selectionCount > 0 && !c.hasArtificialSelection;

const twoCommits = (c: CommandContext): boolean =>
  c.hasRepo && c.selectionCount === 2 && !c.hasArtificialSelection;


export function registerRevisionCommands(): void
{
  // ── Branches ────────────────────────────────────────────────────────────────
  declareCommand('branch.checkout', 'Checkout Branch…', 'Branch', hasRepo);
  /**
   * Check out a branch a row named: the operand carries which one
   * (`menus/resolve.ts`'s `operand`). Separate from `ref.checkout`, which reads its
   * operand from the panel; both share `checkoutRef.ts`.
   *
   * `hasRepo`, not `oneCommit`, because the selection is only the *fallback*: three
   * surfaces name a branch outright, the grid's submenu from the commit under the
   * pointer and the toolbar's and status bar's branch lists from the refs. Requiring a
   * selected commit made every row of those two lists do nothing at all. Run with no
   * operand and no selection, it opens the picker rather than guessing.
   */
  declareCommand('revision.checkoutBranchHere', 'Checkout Branch Here', 'Branch', hasRepo);
  declareCommand('branch.create', 'Create Branch Here…', 'Branch', oneCommit, ['Mod+Shift+B']);
  declareCommand('branch.rename', 'Rename Branch…', 'Branch', oneCommit);
  // `hasRepo`, not `oneCommit`: it acts on branches, and which commit is selected has
  // never had anything to do with it.
  declareCommand('branch.delete', 'Delete Branches…', 'Branch', hasRepo);
  // "This Commit", where the left panel's `ref.merge` says only "Merge into Current
  // Branch…": one label for both would be identical rows in the palette with no way to tell them apart.
  declareCommand(
    'branch.merge',
    'Merge This Commit into Current Branch…',
    'Branch',
    oneCommit
  );
  declareCommand('branch.rebase', 'Rebase Current Branch on Selected', 'Branch', oneCommit);
  declareCommand('branch.rebaseInteractive', 'Rebase Interactively…', 'Branch', oneCommit);
  // `hasRepo`, not `oneCommit`: opens the dialog with no operand, the only way back to the mid-rebase control panel.
  declareCommand('branch.rebaseAdvanced', 'Rebase…', 'Branch', hasRepo);

  // ── Resetting ───────────────────────────────────────────────────────────────
  declareCommand('reset.currentBranch', 'Reset Current Branch to Here…', 'Reset', oneCommit);
  declareCommand('reset.anotherBranch', 'Reset Another Branch to Here…', 'Reset', oneCommit);
  declareCommand('reset.changes', 'Reset Changes…', 'Reset', (c) => c.hasRepo && c.hasChanges);
  // Not gated on `hasChanges`: `git status` says nothing about ignored files, so a
  // repository that looks perfectly clean is exactly the one with a build directory in it.
  declareCommand('workdir.clean', 'Clean Working Directory…', 'Commands', hasRepo);
  // On the Commands menu since Phase 1 with no `run`, so the row toasted instead of opening the resolver.
  declareCommand('conflicts.resolve', 'Solve Merge Conflicts…', 'Commands', hasRepo);

  // ── Commits ─────────────────────────────────────────────────────────────────
  // `Mod+Enter`, not `Mod+Space`: macOS gives `Cmd+Space` to Spotlight, so the keystroke
  // never reaches the window and the app's most-used command had no binding at all.
  declareCommand('commit.open', 'Commit…', 'Commands', hasRepo, ['Mod+Enter']);
  declareCommand('commit.checkout', 'Checkout This Commit…', 'Commands', oneCommit);
  declareCommand('commit.revert', 'Revert This Commit…', 'Commands', anyCommits);
  declareCommand('commit.cherryPick', 'Cherry-pick This Commit…', 'Commands', anyCommits);
  declareCommand('commit.archive', 'Archive This Commit…', 'Commands', oneCommit);
  // Not `oneCommit`: it acts on HEAD, not on whatever row is selected. Undoing the last
  // commit while looking at a commit from last year is still undoing the last commit.
  declareCommand('commit.undo', 'Undo Last Commit…', 'Commands', hasRepo);
  declareCommand('commit.openInNewWindow', 'Open Commit in New Window', 'Commands', oneCommit);
  /**
   * The only survivor of the `Advanced ▸` submenu (fixup, squash, amend, edit, reword).
   * The other four are *markers*: they commit a `fixup!`/`squash!`/`amend!` subject and
   * change nothing else until a later `rebase --autosquash`, which makes them
   * unexplainable as a menu row. Cut, not left greyed: see docs/ARCHITECTURE.md's
   * "Deliberately not built". Reword finishes on its own, so it's `'Commands'`, not `'Advanced'`.
   */
  declareCommand('commit.reword', 'Reword Commit…', 'Commands', oneCommit);

  // ── Tags ────────────────────────────────────────────────────────────────────
  declareCommand('tag.create', 'Create Tag Here…', 'Tag', oneCommit);
  declareCommand('tag.delete', 'Delete Tag…', 'Tag', oneCommit);

  // ── Comparing ───────────────────────────────────────────────────────────────
  // Two rows, both opening the compare dialog with its slots filled in. There were
  // five; the others were cross-invocation hidden state that only existed because
  // there was nowhere to *show* a base: there is now, so both ends are set in one window.
  declareCommand('compare.selected', 'Compare Selected Commits…', 'Compare', twoCommits);
  declareCommand('compare.withCurrent', 'Compare with Current Branch…', 'Compare', oneCommit);

  // ── Patches ─────────────────────────────────────────────────────────────────
  // Both were on the menu bar since Phase 1 with nothing behind them, so the rows
  // toasted. Neither depends on the selection: apply picks a file in the dialog, format opens on whatever the grid has.
  declareCommand('patch.apply', 'Apply Patch…', 'Patch', hasRepo);
  declareCommand('patch.format', 'Format Patch…', 'Patch', hasRepo);

  // ── Bisect, cut ─────────────────────────────────────────────────────────────
  // There were five bisect commands and a submenu drawing the four per-commit ones
  // greyed. Gone: the useful half is `git bisect run`, a command-line gesture; marking
  // good/bad by hand never needed a GUI, and four rows that never lit up were worse than none.
  //
  // Detecting a bisect is *not* cut: `main/git/repo.ts` still reports it and
  // `OperationBanner` offers `git bisect reset`, since a terminal can start one with this app open.

  // ── Stashes ─────────────────────────────────────────────────────────────────
  const stashOperand = (c: CommandContext): boolean =>
    c.selectedNode?.kind === KIND_STASH || oneCommit(c);
  declareCommand('stash.apply', 'Apply Stash…', 'Stash', stashOperand);
  declareCommand('stash.pop', 'Pop Stash…', 'Stash', stashOperand);
  declareCommand('stash.drop', 'Drop Stash…', 'Stash', stashOperand);
}
