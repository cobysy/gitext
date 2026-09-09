/**
 * Resolving a conflict, and finishing the operation that caused one. Taking a side of
 * one file is a *plan*: checkout, then stage, since git leaves a `--ours` checkout still
 * marked conflicted until added. Finishing is one command per operation.
 */

import {
  OPERATION_AM as OP_AM,
  OPERATION_CHERRY_PICK as OP_CHERRY_PICK,
  OPERATION_MERGE as OP_MERGE,
  OPERATION_REBASE as OP_REBASE,
  OPERATION_REVERT as OP_REVERT
} from '@shared/types.js';
import type { ArgvStep } from './checkout.js';

// Conflict sides
const SIDE_OURS = 'ours';
const SIDE_THEIRS = 'theirs';

// Git commands
const CMD_CHECKOUT = 'checkout';
const CMD_ADD = 'add';
const CMD_COMMIT = 'commit';
const CMD_MERGETOOL = 'mergetool';

// Git flags
const FLAG_CONTINUE = '--continue';
const FLAG_ABORT = '--abort';
const FLAG_OURS = '--ours';
const FLAG_THEIRS = '--theirs';
const FLAG_NO_EDIT = '--no-edit';
const FLAG_NO_PROMPT = '--no-prompt';

/**
 * Whose version of a conflicted file to keep. The names are git's and treacherous:
 * during a **rebase** "ours" is the upstream being replayed onto, "theirs" is your own
 * commit. These labels say which side each is in checkable terms.
 */
export type ConflictSide = 'ours' | 'theirs';

export interface ConflictSideInfo {
  side: ConflictSide;
  flag: string;
  /** What this side is during a merge, cherry-pick or revert. */
  merging: string;
  /** What it is during a rebase, where the two are the other way round. */
  rebasing: string;
  /** A two-or-three-word form of `merging`, for per-file row buttons, where the full sentence doesn't fit. Never git's own `side`. */
  mergingShort: string;
  /** The same, for `rebasing`. */
  rebasingShort: string;
  /**
   * One word, for a button: `Keep Mine`. Operation-dependent, and the field most
   * expensive to get wrong: during a **rebase** the commit being replayed is *yours*, so
   * "Mine" belongs to `theirs` there and `ours` during a merge.
   */
  mergingRole: string;
  /** The same, for `rebasing`. */
  rebasingRole: string;
}

export const CONFLICT_SIDES: readonly ConflictSideInfo[] = [
  {
    side: SIDE_OURS,
    flag: FLAG_OURS,
    merging: 'the branch you are on',
    rebasing: 'the branch you are replaying onto',
    mergingShort: 'this branch',
    rebasingShort: 'the base branch',
    mergingRole: 'Mine',
    rebasingRole: 'Base'
  },
  {
    side: SIDE_THEIRS,
    flag: FLAG_THEIRS,
    merging: 'the branch being brought in',
    rebasing: 'the commit being replayed',
    mergingShort: 'the incoming branch',
    rebasingShort: 'this commit',
    mergingRole: 'Incoming',
    // Not "Theirs": during a rebase this side is the commit *you* wrote.
    rebasingRole: 'Mine'
  }
];

export interface DescribedConflictSide extends ConflictSideInfo {
  /** "the branch you are on", picked from `merging`/`rebasing` for the operation in progress. */
  describe: string;
  /** "Mine", picked from `mergingRole`/`rebasingRole` the same way. */
  role: string;
}

/**
 * `CONFLICT_SIDES` with the wording picked for the operation actually in progress:
 * shared by `ResolveConflictsDialog` and `ConflictFileDialog` so the two cannot drift
 * on which sentence describes "ours".
 */
export function describeSides(rebasing: boolean): DescribedConflictSide[]
{
  return CONFLICT_SIDES.map((entry) =>
  {
    let describe: string;
    let role: string;
    if (rebasing)
    {
      describe = entry.rebasing;
      role = entry.rebasingRole;
    }
    else
    {
      describe = entry.merging;
      role = entry.mergingRole;
    }
    return { ...entry, describe, role };
  });
}

/**
 * Take one side of a conflicted file. Two commands, not one: `checkout --ours -- <path>`
 * writes that side but leaves the path still conflicted in the index; `add` is what marks it resolved.
 */
export function buildTakeSideSteps(side: ConflictSide, path: string): ArgvStep[]
{
  const flag = CONFLICT_SIDES.find((entry) => entry.side === side)?.flag ?? FLAG_OURS;
  return [
    { label: `Checking out the ${side} version of ${path}`, argv: [CMD_CHECKOUT, flag, '--', path] },
    { label: `Marking ${path} resolved`, argv: [CMD_ADD, '--', path] }
  ];
}

/**
 * Take the same side of every remaining conflict: one `checkout` naming all the paths
 * and one `add`, not two commands per file, so a forty-file conflict doesn't turn
 * eighty log rows into nothing more useful than two.
 */
export function buildTakeAllSideSteps(side: ConflictSide, paths: readonly string[]): ArgvStep[]
{
  if (paths.length === 0)
  {
    return [];
  }
  const flag = CONFLICT_SIDES.find((entry) => entry.side === side)?.flag ?? FLAG_OURS;
  let many;
  if (paths.length === 1)
  {
    many = 'the file';
  }
  else
  {
    many = `all ${paths.length} files`;
  }
  return [
    {
      label: `Checking out the ${side} version of ${many}`,
      argv: [CMD_CHECKOUT, flag, '--', ...paths]
    },
    { label: `Marking ${many} resolved`, argv: [CMD_ADD, '--', ...paths] }
  ];
}

/** Open one or more files in whatever `merge.tool` is configured: a list reaches git as one command, and it launches the tool once per path. */
export function buildMergetoolArgs(paths: readonly string[]): string[]
{
  // `--no-prompt` because the prompt is a terminal question and there is no terminal.
  return [CMD_MERGETOOL, FLAG_NO_PROMPT, '--', ...paths];
}

/** Mark files resolved as they stand: for ones edited by hand rather than by a tool. */
export function buildMarkResolvedArgs(paths: readonly string[]): string[]
{
  return [CMD_ADD, '--', ...paths];
}

/** The operations that can leave a conflict, and how each is finished or abandoned: a table, not two switch statements, so adding one means one place. */
export type ConflictedOperation =
  | typeof OP_MERGE
  | typeof OP_REBASE
  | typeof OP_CHERRY_PICK
  | typeof OP_REVERT
  | typeof OP_AM;

export interface OperationInfo {
  operation: ConflictedOperation;
  label: string;
  /** What carries on once everything is staged. */
  continueArgv: string[];
  /** What puts the repository back as it was. */
  abortArgv: string[];
}

export const CONFLICTED_OPERATIONS: readonly OperationInfo[] = [
  {
    operation: OP_MERGE,
    label: 'Merge',
    // Not `merge --continue`: it opens an editor, and a stopped merge already has its
    // message in `.git/MERGE_MSG`; `commit --no-edit` is what git itself tells you to run.
    continueArgv: [CMD_COMMIT, FLAG_NO_EDIT],
    abortArgv: [OP_MERGE, FLAG_ABORT]
  },
  {
    operation: OP_REBASE,
    label: 'Rebase',
    continueArgv: [OP_REBASE, FLAG_CONTINUE],
    abortArgv: [OP_REBASE, FLAG_ABORT]
  },
  {
    operation: OP_CHERRY_PICK,
    label: 'Cherry-pick',
    continueArgv: [OP_CHERRY_PICK, FLAG_CONTINUE],
    abortArgv: [OP_CHERRY_PICK, FLAG_ABORT]
  },
  {
    operation: OP_REVERT,
    label: 'Revert',
    continueArgv: [OP_REVERT, FLAG_CONTINUE],
    abortArgv: [OP_REVERT, FLAG_ABORT]
  },
  {
    operation: OP_AM,
    label: 'Apply patch',
    continueArgv: [OP_AM, FLAG_CONTINUE],
    abortArgv: [OP_AM, FLAG_ABORT]
  }
];

export function operationInfo(operation: string): OperationInfo | null
{
  return CONFLICTED_OPERATIONS.find((entry) => entry.operation === operation) ?? null;
}
