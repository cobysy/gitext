/**
 * `git reset` argv.
 *
 * `reset <mode> [--quiet] <commit> [-- <file>]`, where the mode is `--soft`, `--mixed`,
 * `--keep`, `--merge`, `--hard`, or nothing at all for the file form.
 *
 * A table rather than a switch, so a mode is added by adding a row, and so the five modes
 * can be *rendered* from the same place they are built from, which is what stops the
 * dialog's explanation of `--keep` drifting from the flag it produces.
 */

import type { Tone } from '../tone.js';
import type { ArgvStep } from './checkout.js';
import { buildCleanArgs, type CleanMode } from './clean.js';
import { HEAD_REF } from '@renderer/model/sha.js';

// Reset modes
const RESET_MODE_SOFT = 'soft';
const RESET_MODE_MIXED = 'mixed';
const RESET_MODE_KEEP = 'keep';
const RESET_MODE_MERGE = 'merge';
const RESET_MODE_HARD = 'hard';

// Git commands
const CMD_RESET = 'reset';
const CMD_CHECKOUT = 'checkout';

// Tones
const TONE_SAFE = 'safe';
const TONE_CAUTION = 'caution';
const TONE_DANGER = 'danger';


// Git flags
const FLAG_SOFT = '--soft';
const FLAG_MIXED = '--mixed';
const FLAG_KEEP = '--keep';
const FLAG_MERGE = '--merge';
const FLAG_HARD = '--hard';
const FLAG_QUIET = '--quiet';

/**
 * The five modes, in the order the dialog lists them: least destructive first. `index`
 * is git's file form (`reset <tree-ish> -- <path>`, no mode flag), which the file
 * commands use and this dialog never offers.
 */
export type ResetMode = 'soft' | 'mixed' | 'keep' | 'merge' | 'hard';

export interface ResetModeInfo {
  mode: ResetMode;
  /** The flag, or `null` for the mode that is the absence of one. */
  flag: string | null;
  /** The one-line description the dialog lists the mode under. */
  label: string;
  /** What it does to the working directory and the index, in the dialog's own words. */
  detail: string;
  /** git's documentation anchor, so each mode's help link goes to the right paragraph. */
  help: string;
  /** What it costs you: Soft is green, Mixed/Keep/Merge amber, Hard red. Here, not the dialog, since it's a fact about the mode. */
  tone: Tone;
}

/**
 * What each mode is. Ordered least destructive to most, and coloured the same way:
 * Keep and Merge are amber, Hard is red.
 */
export const RESET_MODES: readonly ResetModeInfo[] = [
  {
    mode: RESET_MODE_SOFT,
    tone: TONE_SAFE,
    flag: FLAG_SOFT,
    label: 'Soft',
    detail:
      'Moves the branch. Everything between is left staged.',
    help: 'https://git-scm.com/docs/git-reset#Documentation/git-reset.txt---soft'
  },
  {
    mode: RESET_MODE_MIXED,
    tone: TONE_CAUTION,
    flag: FLAG_MIXED,
    label: 'Mixed',
    detail:
      'Moves the branch. Everything between is left unstaged.',
    help: 'https://git-scm.com/docs/git-reset#Documentation/git-reset.txt---mixed'
  },
  {
    mode: RESET_MODE_KEEP,
    tone: TONE_CAUTION,
    flag: FLAG_KEEP,
    label: 'Keep',
    detail:
      'Keeps your changes, or aborts rather than touch them.',
    help: 'https://git-scm.com/docs/git-reset#Documentation/git-reset.txt---keep'
  },
  {
    mode: RESET_MODE_MERGE,
    tone: TONE_CAUTION,
    flag: FLAG_MERGE,
    label: 'Merge',
    detail:
      'Carries your changes across, or aborts on a conflict.',
    help: 'https://git-scm.com/docs/git-reset#Documentation/git-reset.txt---merge'
  },
  {
    mode: RESET_MODE_HARD,
    tone: TONE_DANGER,
    flag: FLAG_HARD,
    label: 'Hard',
    detail:
      'Discards every local change, committed or not.',
    help: 'https://git-scm.com/docs/git-reset#Documentation/git-reset.txt---hard'
  }
];

export interface ResetOptions {
  mode: ResetMode;
  /** What to reset to: a SHA, a branch, a tag. */
  commit: string;
  /** Suppress git's summary of what's left unstaged. The dialog passes `quiet: false`: the summary is the answer to "what did that do to me". */
  quiet?: boolean;
}

export function buildResetArgs(options: ResetOptions): string[]
{
  const { mode, commit, quiet = false } = options;
  const flag = RESET_MODES.find((entry) => entry.mode === mode)?.flag ?? null;

  const args = [CMD_RESET];
  if (flag)
  {
    args.push(flag);
  }
  if (quiet)
  {
    args.push(FLAG_QUIET);
  }
  if (commit)
  {
    args.push(commit);
  }
  return args;
}

// ── Throwing away uncommitted work ───────────────────────────────────────────

/**
 * Which uncommitted changes are being thrown away: a confirmation and nothing more,
 * the *caller* decides which reset. Named here, not the dialog, to keep the argv and its sentence in one place.
 */
export type DiscardScope = 'all' | 'unstaged';

export interface DiscardScopeInfo {
  scope: DiscardScope;
  title: string;
  /** What survives it, which is the only thing anyone needs to read before pressing. */
  detail: string;
  argv: string[];
}

export const DISCARD_SCOPES: readonly DiscardScopeInfo[] = [
  {
    scope: 'all',
    title: 'Reset all changes',
    detail:
      'Every tracked file goes back to HEAD.',
    // `--hard HEAD` rather than a bare `--hard`: identical to git, and a command log that
    // names the commit says what "back" meant.
    argv: [CMD_RESET, FLAG_HARD, HEAD_REF]
  },
  {
    scope: 'unstaged',
    title: 'Reset unstaged changes',
    detail:
      'Tracked files go back to what you have staged.',
    // `checkout -- .` from the repository root, which is the index as the source.
    argv: [CMD_CHECKOUT, '--', '.']
  }
];

export interface DiscardOptions {
  scope: DiscardScope;
  /**
   * Delete untracked files and directories as well: `clean -df`. Not part of either
   * reset: `--hard` and `checkout -- .` both leave untracked files alone, since git was never told about them.
   */
  deleteUntracked?: boolean;
  /** Include ignored files in the clean: `-x`. Build output as well as new source. */
  includeIgnored?: boolean;
}

/**
 * Everything discarding uncommitted work runs, in order. Two commands when untracked
 * files are included, previewed as one plan rather than as two separate commands you might run.
 */
export function buildDiscardSteps(options: DiscardOptions): ArgvStep[]
{
  const { scope, deleteUntracked = false, includeIgnored = false } = options;
  const entry = DISCARD_SCOPES.find((info) => info.scope === scope);
  if (!entry)
  {
    return [];
  }

  const args = [{ label: 'Resetting your changes', argv: entry.argv }];
  if (deleteUntracked)
  {
    let cleanMode: CleanMode;
    if (includeIgnored)
    {
      cleanMode = 'all';
    }
    else
    {
      cleanMode = 'untracked';
    }
    args.push({
      label: 'Deleting untracked files',
      // Through the clean builder rather than a second spelling of `clean -df`
      // here: one module owns `git clean`, and this dialog's checkbox is a
      // two-value slice of the three modes it offers.
      argv: buildCleanArgs({ mode: cleanMode, directories: true })
    });
  }
  return args;
}

/**
 * Undoing the last commit: `reset --soft HEAD~1`. Soft on purpose, and its own
 * function, not a `buildResetArgs` call with arguments: undoing means the commit's
 * changes come back *staged*, ready to commit again.
 */
export function buildUndoCommitArgs(): string[]
{
  return buildResetArgs({ mode: RESET_MODE_SOFT, commit: 'HEAD~1' });
}
