/** `git revert` argv: separate from cherry-pick (different flags; shared table would grow branches). */

const CMD_REVERT = 'revert';
const FLAG_NO_COMMIT = '--no-commit';
const FLAG_MAINLINE = '-m';

export interface RevertOptions {
  /** The commit whose changes are being undone. */
  sha: string;
  /**
   * Commit the reversal. Off is `--no-commit`, which stages the undo and stops: what you
   * want when several reverts belong in one commit.
   */
  autoCommit?: boolean;
  /**
   * Which parent of a merge to revert *against*, 1-based: `-m <n>`.
   *
   * Reverting a merge undoes the changes the merge brought in relative to this parent, so
   * `1` (the branch the merge landed on) undoes the merged-in work.
   */
  mainline?: number | null;
}

export function buildRevertArgs(options: RevertOptions): string[]
{
  const { sha, autoCommit = true, mainline = null } = options;
  if (!sha.trim())
  {
    return [];
  }

  const args = [CMD_REVERT];
  if (!autoCommit)
  {
    args.push(FLAG_NO_COMMIT);
  }
  if (mainline)
  {
    args.push(FLAG_MAINLINE, String(mainline));
  }
  args.push(sha.trim());
  return args;
}

/** Finishing or abandoning a revert that stopped on a conflict. */
export type RevertStep = 'continue' | 'skip' | 'abort' | 'quit';

export function buildRevertStepArgs(step: RevertStep): string[]
{
  return [CMD_REVERT, `--${step}`];
}
