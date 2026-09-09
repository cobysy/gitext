/**
 * Commit screen commands: list commands (shape/filter) and screen commands.
 * Operand is list/screen not file. Built in commands/staging.actions.ts.
 */

import { declareCommand, type CommandContext } from './registry.js';

const GROUP_COMMIT_SCREEN = 'Commit Screen';

/**
 * The pane every binding here belongs to. `Mod+P` is the command palette everywhere
 * else in the window, and `Mod+A` selects the text under the cursor: a commit-screen
 * key means what it says only while the commit screen has the keyboard.
 */
const COMMIT_SCREEN = 'commitScreen' as const;

const onScreen = (c: CommandContext): boolean => c.stagingSide !== null;
const hasSelection = (c: CommandContext): boolean => c.stagingSelectionCount > 0;

export function registerStagingCommands(): void
{
  // ── The lists' shape ───────────────────────────────────────────────────────
  declareCommand('staging.viewFlat', 'Flat List', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.viewTree', 'Folder Tree', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.groupByExtension', 'Group by Extension', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.groupByStatus', 'Group by Status', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.denseTree', 'Dense Tree', GROUP_COMMIT_SCREEN, onScreen);

  // ── What the lists show ────────────────────────────────────────────────────
  declareCommand('staging.showUntracked', 'Show Untracked Files', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.showIgnored', 'Show Ignored Files', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.showSkipWorktree', 'Show Skip-worktree Files', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand(
    'staging.showAssumeUnchanged',
    'Show Assume-unchanged Files',
    GROUP_COMMIT_SCREEN,
    onScreen
  );
  declareCommand('staging.toggleFilter', 'Selection Filter', GROUP_COMMIT_SCREEN, onScreen);

  // ── Selection ──────────────────────────────────────────────────────────────
  declareCommand('staging.selectAll', 'Select All', GROUP_COMMIT_SCREEN, onScreen, ['Mod+A'], COMMIT_SCREEN);
  // Not `Mod+N`/`Mod+P`: this window registers the whole registry, and `palette.open`
  // claims `Mod+P` window-wide with no `when` to stand it down. It is declared first, so
  // it won, and it opens a palette only the repository window draws: the key did nothing
  // here at all. The arrows say "move through the list" without asking for a free letter.
  declareCommand('staging.selectNext', 'Next File', GROUP_COMMIT_SCREEN, onScreen, ['Mod+Shift+Down'], COMMIT_SCREEN);
  declareCommand('staging.selectPrevious', 'Previous File', GROUP_COMMIT_SCREEN, onScreen, ['Mod+Shift+Up'], COMMIT_SCREEN);

  // ── The screen ─────────────────────────────────────────────────────────────
  declareCommand('staging.stageAll', 'Stage All Changes', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.unstageAll', 'Unstage Everything', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.resetAllChanges', 'Reset All Changes…', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand(
    'staging.resetUnstagedChanges',
    'Reset Unstaged Changes…',
    GROUP_COMMIT_SCREEN,
    onScreen
  );
  declareCommand('staging.stashStaged', 'Stash Staged Changes…', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.resetAuthor', 'Reset Author', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.resetSoft', 'Reset Soft to Previous Commit…', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.commitAndPush', 'Commit and Push', GROUP_COMMIT_SCREEN, onScreen);
  // No hotkey: `Mod+Shift+B` belongs to `branch.create`, and that one is a menu-bar row,
  // so its accelerator is live in this window too. Two commands answering one keystroke in
  // the same window is a coin toss; this one is a row on the Options menu instead.
  declareCommand('staging.createBranch', 'Create Branch…', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.noVerify', 'No Verify (skip hooks)', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand('staging.amend', 'Amend Last Commit', GROUP_COMMIT_SCREEN, onScreen);
  declareCommand(
    'staging.closeWhenDone',
    'Close When Done',
    GROUP_COMMIT_SCREEN,
    onScreen
  );
  declareCommand('staging.refresh', 'Rescan Changes', GROUP_COMMIT_SCREEN, onScreen, ['Mod+Shift+R'], COMMIT_SCREEN);
  // No ellipsis: submenu of prior committers, not text entry.
  declareCommand('staging.changeAuthor', 'Change Author', GROUP_COMMIT_SCREEN, onScreen);

  // ── The message ────────────────────────────────────────────────────────────
  declareCommand(
    'staging.addSelectionToMessage',
    'Add Diff Selection to Message',
    GROUP_COMMIT_SCREEN,
    hasSelection
  );
  // No ellipsis: Mod+T cycles prefix, submenu jumps to one.
  declareCommand('staging.conventionalPrefix', 'Conventional Commit Prefix', GROUP_COMMIT_SCREEN, onScreen, [
    'Mod+T'
  ], COMMIT_SCREEN);
  declareCommand('staging.recentMessages', 'Recent Commit Messages', GROUP_COMMIT_SCREEN, onScreen);

  // ── Focus ──────────────────────────────────────────────────────────────────
  declareCommand('staging.focusUnstaged', 'Focus Unstaged Files', GROUP_COMMIT_SCREEN, onScreen, [
    'Mod+1'
  ], COMMIT_SCREEN);
  declareCommand('staging.focusStaged', 'Focus Staged Files', GROUP_COMMIT_SCREEN, onScreen, ['Mod+2'], COMMIT_SCREEN);
  declareCommand('staging.focusDiff', 'Focus Diff', GROUP_COMMIT_SCREEN, onScreen, ['Mod+3'], COMMIT_SCREEN);
  declareCommand('staging.focusMessage', 'Focus Commit Message', GROUP_COMMIT_SCREEN, onScreen, [
    'Mod+4'
  ], COMMIT_SCREEN);

  // ── The repository that contains this one ──────────────────────────────────
  // Offered only from submodule. hasSuperproject greys the row.
  declareCommand(
    'staging.stageInSuperproject',
    'Stage in Superproject',
    GROUP_COMMIT_SCREEN,
    (c) => onScreen(c) && c.hasSuperproject
  );
  declareCommand(
    'staging.submoduleSummary',
    'Summarize Submodule Changes',
    GROUP_COMMIT_SCREEN,
    onScreen
  );
}
