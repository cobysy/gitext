/**
 * git merge argv. --no-edit unconditional (prevents hang with no terminal for editor).
 */

const STRATEGY_ORT = 'ort';
const STRATEGY_RESOLVE = 'resolve';

const CMD_MERGE = 'merge';
const FLAG_NO_FF = '--no-ff';
const FLAG_SQUASH = '--squash';
const FLAG_NO_COMMIT = '--no-commit';
const FLAG_ALLOW_UNRELATED = '--allow-unrelated-histories';
const FLAG_MESSAGE_FILE = '-F';
const FLAG_NO_EDIT = '--no-edit';

/**
 * The merge strategies offered.
 *
 * Two, not git's five. Octopus, ours and subtree are cut as options almost nobody uses;
 * what is left is the default and the one alternative anyone reaches for.
 * `ort` rather than `recursive`, which it replaced as git's default in 2.34.
 */
export type MergeStrategy = 'ort' | 'resolve';

export interface MergeStrategyInfo {
  strategy: MergeStrategy;
  label: string;
  detail: string;
}

export const MERGE_STRATEGIES: readonly MergeStrategyInfo[] = [
  {
    strategy: STRATEGY_ORT,
    label: 'ort',
    detail:
      "git's default. Handles renames and criss-cross merges.",
  },
  {
    strategy: STRATEGY_RESOLVE,
    label: 'resolve',
    detail:
      'One merge base only: faster, and wrong more often.'
  }
];

export interface MergeOptions {
  /** The branch, tag or commit being merged into the current branch. */
  ref: string;
  /**
   * Let git move the branch pointer when it can, rather than always making a merge commit.
   *
   * The default, and the reason it is a *radio* in the dialog rather than a `--no-ff`
   * checkbox: "keep a single line of history where possible" and "always record that a
   * merge happened" are two intentions, and neither is the absence of the other.
   */
  fastForward?: boolean;
  /** Bring the changes in as one set of staged changes with no merge commit at all. */
  squash?: boolean;
  /** Merge, but stop before committing so the result can be inspected or amended. */
  noCommit?: boolean;
  strategy?: MergeStrategy | null;
  /** Merge two histories with no common ancestor. git refuses without this since 2.9. */
  allowUnrelatedHistories?: boolean;
  /**
   * Path to a file holding the merge message: `.git/MERGE_MSG`.
   *
   * A path rather than the text, because git is given `-F` and never `-m`: `-m` takes the
   * message but leaves `MERGE_MSG` holding git's generated one, so a merge that stops on a
   * conflict offers the wrong text when it is resumed.
   */
  messageFile?: string | null;
  /** Summarize the merged commits in the message: `--log=<n>`. */
  logCount?: number | null;
}

export function buildMergeArgs(options: MergeOptions): string[]
{
  const {
    ref,
    fastForward = true,
    squash = false,
    noCommit = false,
    strategy = null,
    allowUnrelatedHistories = false,
    messageFile = null,
    logCount = null
  } = options;

  const args = [CMD_MERGE];
  if (!fastForward)
  {
    args.push(FLAG_NO_FF);
  }
  if (strategy)
  {
    args.push(`--strategy=${strategy}`);
  }
  if (squash)
  {
    args.push(FLAG_SQUASH);
  }
  if (noCommit)
  {
    args.push(FLAG_NO_COMMIT);
  }
  if (allowUnrelatedHistories)
  {
    args.push(FLAG_ALLOW_UNRELATED);
  }
  if (messageFile)
  {
    args.push(FLAG_MESSAGE_FILE, messageFile);
  }
  if (logCount !== null && logCount > 0)
  {
    args.push(`--log=${logCount}`);
  }
  // Unconditional: without it git opens $EDITOR in a terminal nobody is looking at,
  // and the merge reads as a hang.
  args.push(FLAG_NO_EDIT);
  if (ref)
  {
    args.push(ref);
  }
  return args;
}
