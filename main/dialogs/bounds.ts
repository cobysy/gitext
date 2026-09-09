/**
 * Dialog window placement and remembered bounds (separate from lifecycle/BrowserWindow tracking).
 */

import { BrowserWindow, screen } from 'electron';
import {
  centredOn,
  clampToWorkArea,
  normalizeDialogBounds,
  placeInWorkArea,
  storedBounds,
  type DialogBounds
} from '@shared/dialogBounds.js';
import { boundsKeyFor, DIALOG_WINDOWS, type DialogName } from '@shared/dialogs.js';
import { getSettings, patchSettings } from '../settings.js';

/** Where a dialog opens, and the spot it should settle back to once it has a real height. */
export interface DialogPlacement {
  bounds: DialogBounds;
  /**
   * Where the user left this window, or `null` when nobody chose the spot.
   *
   * `bounds` is that position fitted to the height the window *opens* at, which is only
   * `DIALOG_WINDOWS`' first guess: usually a good deal taller than the form, so a window
   * left low is pushed up further than it needs to be. Keeping the position lets
   * `main/dialogs/fit.ts` honour it again against the height the form turns out to need.
   *
   * Its absence is what says "re-centre me as I grow". Growing is not a reason to undo a
   * drag, and re-centring on every measurement is what quietly made a remembered position
   * something you could never actually get back.
   */
  anchor: { x: number; y: number } | null;
}

/**
 * Where this dialog should open: where it was left, at the width it was left, and at
 * whatever height its form turns out to need.
 *
 * **The stored height is deliberately not read back.** Since `fit.ts`, the height of a
 * dialog window is a fact about the form inside it rather than a preference: remembering
 * one would mean a dialog that grew to show an unfolded options panel stayed that tall
 * forever afterwards, and one folded shut could never grow again. Position and width are
 * still yours: where a window sits and how wide its fields are is a choice the content
 * cannot make for you. The height that `rememberBounds` writes is kept in the record
 * rather than stripped from it, because a record is also what an older or newer build
 * reads, and dropping a key it might want is not this function's decision to make.
 */
export function boundsFor(owner: BrowserWindow, name: DialogName): DialogPlacement
{
  const spec = DIALOG_WINDOWS[name];
  const parent = owner.getBounds();
  const area = screen.getDisplayMatching(parent).workArea;

  // A full-window dialog matches the window it was opened from, every time, not a
  // preference to store, the same reason its height was never read back even before it
  // had `fullWindow` to say so. See `DialogWindowSpec.fullWindow`.
  if (spec.fullWindow)
  {
    return {
      bounds: placeInWorkArea(
        { x: parent.x, y: parent.y, w: parent.width, h: parent.height },
        area
      ),
      anchor: null
    };
  }

  const record = normalizeDialogBounds(getSettings().dialogBounds);
  const stored = storedBounds(record, boundsKeyFor(name), area);
  if (stored)
  {
    return {
      bounds: clampToWorkArea({ ...stored, h: spec.height }, area),
      anchor: { x: stored.x, y: stored.y }
    };
  }
  else
  {
    return { bounds: centredOn(parent, { w: spec.width, h: spec.height }, area), anchor: null };
  }
}

/** Remember where a dialog was left, so it reopens there. */
export function rememberBounds(name: DialogName, win: BrowserWindow): void
{
  if (win.isDestroyed())
  {
    return;
  }
  // Nothing to remember: a full-window dialog recomputes its bounds from the owner on
  // every open, and a stored size here would be dead weight nothing ever reads.
  if (DIALOG_WINDOWS[name].fullWindow)
  {
    return;
  }
  const { x, y, width, height } = win.getBounds();
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const record = normalizeDialogBounds(getSettings().dialogBounds);
  patchSettings({
    dialogBounds: {
      ...record,
      [boundsKeyFor(name)]: clampToWorkArea({ x, y, w: width, h: height }, area)
    }
  });
}
