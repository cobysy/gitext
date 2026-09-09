/**
 * Persisted dialog window bounds: `x`/`y` alongside `w`/`h`, keyed by the dialog's name.
 * A stored record from an older build, or an unplugged monitor, can arrive intact and
 * nonsense (`x: 3400` on a single-screen laptop), so this reconciles it on every read.
 * In `shared/` since both sides need it: main restores bounds, the setting crosses IPC.
 */

import { isPlainRecord } from './record.js';

export interface DialogBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A display's usable area, as Electron reports it: origin plus size. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Narrow enough for a two-field form, wide enough for a footer of two buttons. */
export const MIN_DIALOG_WIDTH = 320;
/** A header, one row of body, and the footer. Below this nothing is readable. */
export const MIN_DIALOG_HEIGHT = 160;

/**
 * How much taller than its content a dialog is drawn, in pixels: room for the form to
 * change without the window having to (a preview line, an error, a wrapped hint). A
 * strip, not a proportion: half again over a 660px form is 330px of nothing, worst on
 * the tallest forms. A fold opening changes the form's shape and grows the window instead.
 *
 * One of those lines and the gap above it, and no more. The window grows the moment the
 * content asks for more, so a wider strip buys nothing but a hole: a short form draws its
 * buttons an inch below the last thing it says, which reads as a section that failed to
 * render rather than as room.
 */
export const DIALOG_HEADROOM_PX = 32;

/**
 * How tall a dialog window should be, given what its renderer just measured and the
 * tallest it's already been while open. Only ever grows: a list-and-pane dialog is a
 * different height per row, and following the measurement down as well as up would
 * resize the window under the pointer on every click. The floor is per opening: it goes
 * when the window closes, since a form that grew once isn't a preference.
 */
export function grownDialogHeight(previous: number | null, contentHeight: number): number
{
  return Math.max(previous ?? 0, Math.ceil(contentHeight) + DIALOG_HEADROOM_PX);
}

/**
 * How much of a window must stay inside the work area on an edge it may hang off: a
 * dragged-off position is valid, but not so far there's nothing left to grab.
 */
const MIN_VISIBLE = 80;

/** One axis of a work area: where it starts, and how far it runs. */
interface Axis {
  origin: number;
  extent: number;
}

/**
 * Where a window of this `size` sits on one axis, given how much must stay inside.
 * `visible` is the whole size for an edge nothing may cross, `MIN_VISIBLE` for one it
 * may hang off. The lower bound applies last, so an oversized window on a short display
 * starts at the origin and overflows the far end, not the near one where the title bar is.
 */
function clampAxis(position: number, size: number, axis: Axis, visible: number): number
{
  const keep = Math.min(size, visible);
  const min = axis.origin - size + keep;
  const max = axis.origin + axis.extent - keep;
  return Math.max(min, Math.min(max, Math.round(position)));
}

/** The size clamped to the display: capped by the work area, floored by the minimums. */
function sizeInto(bounds: DialogBounds, area: WorkArea): { w: number; h: number }
{
  return {
    w: Math.min(
      Math.max(MIN_DIALOG_WIDTH, Math.round(bounds.w)),
      Math.max(MIN_DIALOG_WIDTH, area.width)
    ),
    h: Math.min(
      Math.max(MIN_DIALOG_HEIGHT, Math.round(bounds.h)),
      Math.max(MIN_DIALOG_HEIGHT, area.height)
    )
  };
}

/** True for a real, finite number, not `NaN`, not `Infinity`, not some other JSON value. */
function isFiniteNumber(value: unknown): value is number
{
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reconcile the stored record with what this build can honour. Unknown keys are kept:
 * a removed dialog may come back. Malformed entries are dropped: a `NaN` width is a window with no size at all.
 */
export function normalizeDialogBounds(value: unknown): Record<string, DialogBounds>
{
  if (!isPlainRecord(value))
  {
    return {};
  }

  const result: Record<string, DialogBounds> = {};
  for (const [key, entry] of Object.entries(value))
  {
    if (!isPlainRecord(entry))
    {
      continue;
    }
    const { x, y, w, h } = entry as Partial<DialogBounds>;
    if (![x, y, w, h].every(isFiniteNumber))
    {
      continue;
    }
    result[key] = {
      x: Math.round(x as number),
      y: Math.round(y as number),
      w: Math.max(MIN_DIALOG_WIDTH, Math.round(w as number)),
      h: Math.max(MIN_DIALOG_HEIGHT, Math.round(h as number))
    };
  }
  return result;
}

/**
 * Fit a position the **user** chose onto the display it's about to show on. The size
 * is capped by the work area, floored by the minimums: the minimums win, since a
 * 200px-clamped window on a small screen would be unusable, not just cropped. Sideways
 * it's pulled back only far enough to leave a strip to grab.
 *
 * **Vertically nothing may hang off at all**: a dialog's height is the form's, not the
 * user's (see `boundsFor`), so a `y` that sat well for one height could put the next one's footer off the bottom.
 */
export function clampToWorkArea(bounds: DialogBounds, area: WorkArea): DialogBounds
{
  const { w, h } = sizeInto(bounds, area);
  return {
    w,
    h,
    x: clampAxis(bounds.x, w, { origin: area.x, extent: area.width }, MIN_VISIBLE),
    y: clampAxis(bounds.y, h, { origin: area.y, extent: area.height }, h)
  };
}

/**
 * Fit a position the **app** chose: the whole window inside the work area, both axes.
 * Sideways matters as much as vertically, since the footer's buttons sit at its
 * right-hand end: a window centred on a parent that hangs off screen takes them with it.
 */
export function placeInWorkArea(bounds: DialogBounds, area: WorkArea): DialogBounds
{
  const { w, h } = sizeInto(bounds, area);
  return {
    w,
    h,
    x: clampAxis(bounds.x, w, { origin: area.x, extent: area.width }, w),
    y: clampAxis(bounds.y, h, { origin: area.y, extent: area.height }, h)
  };
}

/**
 * Read one dialog's stored bounds, or `null` when it's never been opened: not a
 * default position, but "put it where a new window goes" (centred on its parent).
 */
export function storedBounds(
  record: Record<string, DialogBounds>,
  key: string,
  area: WorkArea
): DialogBounds | null
{
  const stored = record[key];
  if (stored)
  {
    return clampToWorkArea(stored, area);
  }
  else
  {
    return null;
  }
}

/**
 * Where a dialog opens with no stored bounds: centred on the window that opened it,
 * then fitted to the display. On the *parent*, not the screen: that's where the user is
 * looking, and dragging it aside then reveals what's behind.
 */
export function centredOn(
  parent: WorkArea,
  size: { w: number; h: number },
  area: WorkArea
): DialogBounds
{
  return placeInWorkArea(
    {
      w: size.w,
      h: size.h,
      x: Math.round(parent.x + (parent.width - size.w) / 2),
      y: Math.round(parent.y + (parent.height - size.h) / 2)
    },
    area
  );
}
