/**
 * Which of the seven palette colours a new line takes.
 *
 * The seed proposes and the lines already drawn veto: a colour comes from the sha of the
 * commit the line is heading for, then steps forward until it clears whatever the caller
 * has ruled out. Seven, because `tokens.css` defines `--graph-0` through `--graph-6`;
 * the count is load-bearing, since a colour is a seed modulo it.
 *
 * A colour is decided once, when a line is created, and never revisited. That is the
 * whole of why a line cannot change colour part-way down.
 */

export const GRAPH_COLOR_COUNT = 7;

/** No veto: a colour index is never negative, so -1 can never match one. */
export const NO_COLOR = -1;

/**
 * FNV-1a over the whole sha. Any spread would do: what matters is that it depends only
 * on the sha, so a colour survives a re-layout, a scroll and a reload unchanged.
 */
export function hashSha(sha: string): number
{
  let hash = 0x811c9dc5;
  for (let index = 0; index < sha.length; index++)
  {
    hash ^= sha.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The seed's colour, or the next one along that `vetoed` does not claim.
 *
 * `vetoed` is a bit per colour. If every colour is spoken for the seed's own is
 * returned, so the search is bounded and a caller can offer a wide veto first and a
 * narrow one second without risking a hang.
 */
export function pickColor(seed: number, vetoed: number): number
{
  const first = seed % GRAPH_COLOR_COUNT;
  for (let step = 0; step < GRAPH_COLOR_COUNT; step++)
  {
    const color = (first + step) % GRAPH_COLOR_COUNT;
    if ((vetoed & (1 << color)) === 0)
    {
      return color;
    }
  }
  return first;
}

/** Add one colour to a veto mask. `NO_COLOR` adds nothing. */
export function veto(mask: number, color: number): number
{
  if (color === NO_COLOR)
  {
    return mask;
  }
  return mask | (1 << color);
}

/** True when a mask leaves nothing to choose from. */
export function vetoesEverything(mask: number): boolean
{
  return (mask & ((1 << GRAPH_COLOR_COUNT) - 1)) === (1 << GRAPH_COLOR_COUNT) - 1;
}
