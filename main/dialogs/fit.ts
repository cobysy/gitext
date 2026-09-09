/**
 * Sizing a dialog window to the dialog inside it. The renderer measures itself and
 * says so via `dialog:fit`; this decides whether to act on it. Four rules:
 *
 * 1. Once the user drags or moves the window, this stops for as long as it's open
 *    (`will-resize`/`will-move` fire only for gestures the user started); it doesn't
 *    persist, see `bounds.ts` for why.
 * 2. It never exceeds the display or hangs off it: the window moves as well as sizes,
 *    since it grows downward and the footer would leave the screen first. A taller
 *    form scrolls inside `DialogFrame`'s body.
 * 3. **It only ever grows while open.** A browsed dialog has a different pane per row,
 *    and following the measurement down would resize the window under the pointer on
 *    every click.
 * 4. **Headroom** over the measurement, so a preview gaining a line doesn't move the window.
 *
 * Rules 3 and 4 are arithmetic, in `shared/dialogBounds.ts`'s `grownDialogHeight`,
 * testable without an Electron window.
 *
 * The window stays hidden until the first measurement, and transparent across being
 * shown, so the resizes needed to reach the right size are invisible.
 */

import { BrowserWindow, screen } from 'electron';
import {
  centredOn,
  clampToWorkArea,
  grownDialogHeight,
  MIN_DIALOG_HEIGHT,
  type DialogBounds,
  type WorkArea
} from '@shared/dialogBounds.js';
import { showWindow } from '../background.js';

interface FitState {
  /** False once the size is someone's decision rather than a default. */
  allowed: boolean;
  /** Where the user left the window, or `null` to keep it centred as it grows. */
  anchor: { x: number; y: number } | null;
  /** Where the window opened, for keeping it centred as it grows. */
  parent: BrowserWindow;
  /** Called on the first measurement: how the window gets shown. See `trackFit`. */
  reveal: (() => void) | null;
  /** The tallest height asked for: re-asserted once the frame is real, and rule 3's floor. */
  wanted: number | null;
}

const states = new Map<number, FitState>();

/**
 * How long to wait for the renderer to measure itself before showing the window anyway.
 * A dialog that throws on mount must still appear.
 */
const REVEAL_TIMEOUT_MS = 1500;

/**
 * Start managing this dialog window's height. `anchor` is where the user left it, or
 * null when nobody chose. `wanted` seeds the height `reveal()` re-asserts after
 * `show()`; a `fullWindow` dialog reports `0` instead, so `main/dialogs.ts` seeds it
 * with the owner's content height.
 */
export function trackFit(
  win: BrowserWindow,
  parent: BrowserWindow,
  anchor: { x: number; y: number } | null,
  wanted: number | null = null
): void
{
  const state: FitState = { allowed: true, anchor, parent, reveal: null, wanted };
  states.set(win.id, state);

  const stop = (): void =>
  {
    state.allowed = false;
  };
  win.on('will-resize', stop);
  win.on('will-move', stop);
  win.on('closed', () => states.delete(win.id));

  /**
   * Show the window, and re-apply the height once the frame is real: a window sized
   * while hidden doesn't keep that size on macOS (`titleBarStyle: 'hidden'` still has a
   * title bar until `show()`, which then eats 32px). Transparent across the pair, since `show()` animates.
   */
  const reveal = (): void =>
  {
    if (!state.reveal)
    {
      return;
    }
    state.reveal = null;
    if (win.isDestroyed())
    {
      return;
    }

    win.setOpacity(0);
    try
    {
      showWindow(win);
      applyWanted(win, state);
    }
    finally
    {
      // A throw above must not leave a window that is open, modal over its parent, and
      // invisible: that takes the repository window down with it.
      if (!win.isDestroyed())
      {
        win.setOpacity(1);
      }
    }
  };
  state.reveal = reveal;

  win.once('ready-to-show', () =>
  {
    setTimeout(reveal, REVEAL_TIMEOUT_MS);
  });
}

/** True when there is a measured height to size `win` to, and the window can still take it. */
function canApplyWantedHeight(height: number | null, win: BrowserWindow, state: FitState): height is number
{
  return height !== null && state.allowed && !win.isDestroyed();
}

/**
 * Where the window goes once it's this tall: centred on its parent while the position
 * is nobody's choice, otherwise back at the anchor, both fitted to the display so a
 * downward-growing window doesn't put its footer off screen.
 */
function grownBounds(win: BrowserWindow, state: FitState, height: number, area: WorkArea): DialogBounds
{
  const width = win.getContentBounds().width;
  const anchor = state.anchor;
  if (anchor)
  {
    return clampToWorkArea({ x: anchor.x, y: anchor.y, w: width, h: height }, area);
  }
  else
  {
    return centredOn(state.parent.getBounds(), { w: width, h: height }, area);
  }
}

/**
 * Size the window to `state.wanted`, the tallest height asked for. `setContentBounds`,
 * not `setBounds`: what was measured is the page, without whatever frame the OS adds.
 */
function applyWanted(win: BrowserWindow, state: FitState): void
{
  const height = state.wanted;
  if (!canApplyWantedHeight(height, win, state))
  {
    return;
  }

  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const current = win.getContentBounds();
  // Never the whole display: the repository has to stay visible behind the dialog.
  const ceiling = Math.round(area.height * 0.92);
  const wanted = Math.min(ceiling, Math.max(MIN_DIALOG_HEIGHT, height));
  const next = grownBounds(win, state, wanted, area);
  // A move counts as well as a resize: a window that fits already may still be sitting
  // where a shorter one fitted, with its buttons under the edge of the screen.
  if (Math.abs(next.h - current.height) <= 2 && next.x === current.x && next.y === current.y)
  {
    return;
  }

  // Spelled out rather than spread: `DialogBounds` is `{ x, y, w, h }`, and Electron takes
  // `{ x, y, width, height }` and silently ignores a size it does not recognise.
  win.setContentBounds({ x: next.x, y: next.y, width: next.w, height: next.h });
}

/**
 * The renderer has measured itself: make the window that tall. `contentHeight` is the
 * page's height; converting to a window height is this side's job. The renderer must
 * never use `outerHeight - innerHeight`, which lags a resize by a frame.
 */
export function fitToContent(win: BrowserWindow, contentHeight: number): void
{
  const state = states.get(win.id);
  if (!state || win.isDestroyed())
  {
    return;
  }

  // Zero is a `fixedHeight` dialog saying it has drawn itself and its height is not this
  // side's business. It is sent only to reach the reveal below.
  if (Number.isFinite(contentHeight) && contentHeight > 0)
  {
    state.wanted = grownDialogHeight(state.wanted, contentHeight);
    applyWanted(win, state);
  }

  // The first measurement is the signal that the dialog has drawn itself, whether or not
  // the size is ours to change.
  if (state.reveal)
  {
    state.reveal();
  }
}
