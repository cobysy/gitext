/**
 * Delete branches: -d for git-verified merged, -D for app-verified squash-merged (two steps).
 * Keeps git's verification on verified branches; -D safety gap shown visibly.
 */

const CMD_BRANCH = 'branch';
const FLAG_DELETE = '-d';
const FLAG_DELETE_FORCE = '-D';

export interface BranchDeletionPlan {
  /** Branches git can confirm are merged: deleted with `-d`. */
  safe: readonly string[];
  /** Branches only this app can confirm landed: deleted with `-D`. */
  forced: readonly string[];
}

export function buildBranchDeleteSteps(plan: BranchDeletionPlan): string[][]
{
  const steps: string[][] = [];
  if (plan.safe.length > 0)
  {
    steps.push([CMD_BRANCH, FLAG_DELETE, ...plan.safe]);
  }
  if (plan.forced.length > 0)
  {
    steps.push([CMD_BRANCH, FLAG_DELETE_FORCE, ...plan.forced]);
  }
  return steps;
}
