/**
 * The indices a shift-click covers. Both lists that extend a selection from an anchor,
 * the revision grid by SHA and a file list by path, had worked this out for themselves,
 * and both had to remember that a range runs upwards as readily as downwards: the
 * anchor is where you started, not the top.
 *
 * Indices rather than the items, since one caller reads rows and the other reads paths.
 */

/** Every index from `from` to `to`, inclusive, in the direction they lie. */
export function indexRange(from: number, to: number): number[]
{
  let step: number;
  if (to >= from)
  {
    step = 1;
  }
  else
  {
    step = -1;
  }

  const indices: number[] = [];
  for (let i = from; i !== to + step; i += step)
  {
    indices.push(i);
  }
  return indices;
}
