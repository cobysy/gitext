/**
 * What the branch manager says about a local branch, and which of the picked ones a
 * delete can be given. Pure, so the wording and the arithmetic are unit tests rather
 * than something only reachable by opening the window.
 */

import type { RefEntry } from '@shared/types.js';

/**
 * The states a row reads out after its upstream, in the order they matter: where you
 * are, how far it is from what it tracks, and whether deleting it loses work. The
 * upstream itself is not here: it is a ref, and the row sets it in the code font.
 */
export function branchStates(entry: RefEntry, merged: boolean): string[]
{
  const states: string[] = [];
  if (entry.isCurrent)
  {
    states.push('you are here');
  }
  if (entry.upstreamGone)
  {
    states.push('upstream gone');
  }
  if (entry.ahead > 0)
  {
    states.push(`${entry.ahead} ahead`);
  }
  if (entry.behind > 0)
  {
    states.push(`${entry.behind} behind`);
  }
  // The checked-out branch is `HEAD`, so it is merged by definition and saying so is noise.
  if (!merged && !entry.isCurrent)
  {
    states.push('not merged');
  }
  return states;
}

/** The picked branches git can be asked to delete: never the one checked out. */
export function deletable(picked: readonly RefEntry[]): RefEntry[]
{
  return picked.filter((entry) => !entry.isCurrent);
}

/** Every branch a plain `-d` would take, in list order: merged, and not checked out. */
export function mergedNames(
  branches: readonly RefEntry[],
  isMerged: (entry: RefEntry) => boolean
): string[]
{
  return deletable(branches)
    .filter(isMerged)
    .map((entry) => entry.name);
}
