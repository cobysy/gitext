/**
 * How the commit screen divides one column between its unstaged and staged lists.
 *
 * Neither list owns the spare room. Both fitting, each takes its rows and half of what
 * is left, so the divider sits between two lists rather than flush against the last
 * staged file. Not both fitting, a list that fits in half the column is shown whole and
 * the other scrolls; neither fitting, they split it down the middle. Rows are what is
 * weighed, never their ratio: forty unstaged files beside one staged one would otherwise
 * squeeze the staged list to nothing, which is the list a commit is made from.
 */

export interface ListSplit {
  /** The column's height, less the divider. */
  available: number;
  /** What each list would take with nothing holding it back: heading, filter and rows. */
  staged: number;
  unstaged: number;
  /** The least either list is given. */
  min: number;
}

/** The staged list's height. The unstaged list takes the rest of the column. */
export function stagedHeight({ available, staged, unstaged, min }: ListSplit): number
{
  const wanted = balancedStaged(available, staged, unstaged);
  const ceiling = Math.max(min, available - min);
  return Math.round(Math.min(Math.max(wanted, min), ceiling));
}

function balancedStaged(available: number, staged: number, unstaged: number): number
{
  const half = available / 2;
  if (staged + unstaged <= available)
  {
    return staged + (available - staged - unstaged) / 2;
  }
  if (staged <= half)
  {
    return staged;
  }
  if (unstaged <= half)
  {
    return available - unstaged;
  }
  return half;
}
