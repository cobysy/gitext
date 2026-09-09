/**
 * Selecting paths in a file list: one, several, a range, a folderful. Plain functions
 * over plain data, so anchored range extension is a unit test rather than something
 * only reachable by clicking. The state is the picked paths oldest-first, plus the
 * anchor a shift-click measures from; the *last* pick is the file the diff pane shows.
 * "Order" throughout means the list as *drawn*: a tree, grouping and filtered list are three different orders over the same files.
 */

import { indexRange } from '@renderer/model/indexRange.js';

export const MODE_TOGGLE = 'toggle' as const;
export const MODE_RANGE = 'range' as const;
export const MODE_REPLACE = 'replace' as const;

/** How a click changes the selection. The revision grid's three modes, by the same names. */
export type SelectMode = typeof MODE_REPLACE | typeof MODE_TOGGLE | typeof MODE_RANGE;

/** How a folderful of paths changes it. There is no range from a folder. */
export type MultiSelectMode = typeof MODE_REPLACE | typeof MODE_TOGGLE;

/**
 * `P` is the path type a caller's paths actually are: plain `string` by default, or a
 * domain type like `renderer/model/paths.ts`'s `FilePath` for a caller that has one.
 * The arithmetic below never inspects a path's content, so it works unchanged either
 * way; only the type parameter says what a picked path is *of*.
 */
export interface PathSelection<P extends string = string> {
  /** Picked paths, oldest pick first. */
  readonly picks: readonly P[];
  /** Where a range measures from. Moves on a plain click or a toggle, never on a range. */
  readonly anchor: P | null;
}

/** Typed `PathSelection<never>`: an empty pick list and null anchor satisfy any `PathSelection<P>`, so this one constant is assignable everywhere. */
export const EMPTY_SELECTION: PathSelection<never> = { picks: [], anchor: null };

/** One path, in one of the three modes. A range with no anchor, or one no longer drawn, falls back to a plain click rather than doing nothing. */
export function pickPath<P extends string>(
  state: PathSelection<P>,
  path: P,
  mode: SelectMode,
  order: readonly P[]
): PathSelection<P>
{
  if (mode === MODE_TOGGLE)
  {
    // Re-picking the last file leaves the pane showing something rather than nothing.
    let picks;
    if (state.picks.includes(path))
    {
      picks = state.picks.filter((p) => p !== path);
    }
    else
    {
      picks = [...state.picks, path];
    }
    return { picks, anchor: path };
  }

  if (mode === MODE_RANGE)
  {
    let from;
    if (state.anchor === null)
    {
      from = -1;
    }
    else
    {
      from = order.indexOf(state.anchor);
    }
    const to = order.indexOf(path);
    if (from !== -1 && to !== -1)
    {
      const picks = indexRange(from, to).map((i) => order[i]!);
      // The anchor stays put, so shift-clicking repeatedly grows and shrinks one range from a fixed end.
      return { picks, anchor: state.anchor };
    }
  }

  return { picks: [path], anchor: path };
}

/**
 * Several paths at once: a folder row, a group heading, select-all. `toggle` is
 * all-or-nothing on the group, not per path: a half-picked folder completes on
 * Ctrl-click, so clicking twice returns you to where you started.
 */
export function pickPaths<P extends string>(
  state: PathSelection<P>,
  paths: readonly P[],
  mode: MultiSelectMode
): PathSelection<P>
{
  if (paths.length === 0)
  {
    return state;
  }
  const last = paths[paths.length - 1]!;

  if (mode === MODE_TOGGLE)
  {
    const picked = new Set(state.picks);
    const wanted = new Set(paths);
    const rest = state.picks.filter((p) => !wanted.has(p));
    if (paths.every((p) => picked.has(p)))
    {
      // The anchor can't stay on a path that's no longer picked, or the next shift-click would measure from a row that looks unselected.
      return { picks: rest, anchor: rest[rest.length - 1] ?? null };
    }
    return { picks: [...rest, ...paths], anchor: last };
  }

  return { picks: [...paths], anchor: last };
}

/**
 * Move the selection one row along the drawn list. Stops at the ends rather than
 * wrapping. `extend` is the shift-arrow, growing the range from the anchor. `from` is
 * the file the diff pane is showing, not always the last pick.
 */
export function stepPath<P extends string>(
  state: PathSelection<P>,
  from: P | null,
  delta: number,
  order: readonly P[],
  extend = false
): PathSelection<P>
{
  if (order.length === 0)
  {
    return state;
  }
  let at;
  if (from === null)
  {
    at = -1;
  }
  else
  {
    at = order.indexOf(from);
  }
  // A selection inside a collapsed folder is not drawn, so the move starts at the end the arrow came from.
  const next = Math.min(order.length - 1, Math.max(0, at + delta));
  let mode: SelectMode;
  if (extend)
  {
    mode = MODE_RANGE;
  }
  else
  {
    mode = MODE_REPLACE;
  }
  return pickPath(state, order[next]!, mode, order);
}
