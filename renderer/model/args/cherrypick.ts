/**
 * `git cherry-pick` argv. The `-m` is load-bearing for merges: git refuses without it.
 */

const CMD_CHERRY_PICK = 'cherry-pick';
const FLAG_NO_COMMIT = '--no-commit';
const FLAG_MAINLINE = '-m';
const FLAG_ADD_REFERENCE = '-x';

export interface CherryPickOptions {
  sha: string;
  /**
   * Commit the result. Off is `--no-commit`: changes land staged only.
   */
  autoCommit?: boolean;
  /**
   * Add `(cherry picked from commit …)` to the message: `-x`. Git accepts it always.
   */
  addReference?: boolean;
  /**
   * Which parent of a merge is mainline (1-based): `-m <n>`. Null for ordinary commits.
   */
  mainline?: number | null;
}

export function buildCherryPickArgs(options: CherryPickOptions): string[]
{
  const { sha, autoCommit = true, addReference = false, mainline = null } = options;
  if (!sha.trim())
  {
    return [];
  }

  const args = [CMD_CHERRY_PICK];
  if (!autoCommit)
  {
    args.push(FLAG_NO_COMMIT);
  }
  if (mainline)
  {
    args.push(FLAG_MAINLINE, String(mainline));
  }
  if (addReference)
  {
    args.push(FLAG_ADD_REFERENCE);
  }
  args.push(sha.trim());
  return args;
}

/**
 * Finishing a stopped cherry-pick: conflict leaves sequencer running, like rebase.
 */
export type CherryPickStep = 'continue' | 'skip' | 'abort' | 'quit';

export function buildCherryPickStepArgs(step: CherryPickStep): string[]
{
  return [CMD_CHERRY_PICK, `--${step}`];
}
