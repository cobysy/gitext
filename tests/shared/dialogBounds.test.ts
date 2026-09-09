import { describe, expect, it } from 'vitest';
import {
  centredOn,
  clampToWorkArea,
  DIALOG_HEADROOM_PX,
  grownDialogHeight,
  MIN_DIALOG_HEIGHT,
  MIN_DIALOG_WIDTH,
  normalizeDialogBounds,
  placeInWorkArea,
  storedBounds
} from '@shared/dialogBounds.js';

/** A single display with a menu bar across the top, which is the interesting case. */
const AREA = { x: 0, y: 25, width: 1600, height: 975 };

describe('normalizeDialogBounds', () =>
{
  it('reads a well-formed record back unchanged', () =>
  {
    const stored = { 'branch.checkout': { x: 100, y: 80, w: 700, h: 500 } };
    expect(normalizeDialogBounds(stored)).toEqual(stored);
  });

  it('answers an empty record for anything that is not one', () =>
  {
    for (const value of [null, undefined, 42, 'checkout', [{ x: 0, y: 0, w: 1, h: 2 }]])
    {
      expect(normalizeDialogBounds(value)).toEqual({});
    }
  });

  it('drops entries with a non-finite or missing dimension', () =>
  {
    const bounds = normalizeDialogBounds({
      good: { x: 10, y: 10, w: 700, h: 500 },
      nan: { x: 10, y: 10, w: Number.NaN, h: 500 },
      infinite: { x: 10, y: 10, w: 700, h: Number.POSITIVE_INFINITY },
      // A record written before the windows grew coordinates: a size with no position
      // says nothing about where to put the window, so it goes.
      sizeOnly: { w: 700, h: 500 },
      stringly: { x: '10', y: '10', w: '700', h: '500' },
      nothing: null
    });
    expect(Object.keys(bounds)).toEqual(['good']);
  });

  it('raises a size below the minimum, so a window dragged to nothing comes back', () =>
  {
    expect(normalizeDialogBounds({ tiny: { x: 0, y: 0, w: 10, h: 10 } })).toEqual({
      tiny: { x: 0, y: 0, w: MIN_DIALOG_WIDTH, h: MIN_DIALOG_HEIGHT }
    });
  });

  it('rounds, because Electron takes integer bounds', () =>
  {
    expect(normalizeDialogBounds({ d: { x: 10.4, y: 10.6, w: 700.4, h: 500.6 } })).toEqual({
      d: { x: 10, y: 11, w: 700, h: 501 }
    });
  });

  it('allows a negative origin: a second display can be to the left of the first', () =>
  {
    expect(normalizeDialogBounds({ d: { x: -1200, y: 40, w: 700, h: 500 } })).toEqual({
      d: { x: -1200, y: 40, w: 700, h: 500 }
    });
  });

  it('keeps a key this build has no dialog for', () =>
  {
    const stored = { 'not-a-dialog': { x: 5, y: 5, w: 700, h: 500 } };
    expect(normalizeDialogBounds(stored)).toEqual(stored);
  });
});

describe('clampToWorkArea', () =>
{
  it('leaves bounds that fit alone', () =>
  {
    const bounds = { x: 100, y: 100, w: 700, h: 500 };
    expect(clampToWorkArea(bounds, AREA)).toEqual(bounds);
  });

  it('fits a size written on a larger monitor', () =>
  {
    expect(clampToWorkArea({ x: 0, y: 25, w: 3000, h: 2000 }, AREA)).toEqual({
      x: 0,
      y: 25,
      w: AREA.width,
      h: AREA.height
    });
  });

  it('keeps the minimum size when the display is smaller than it', () =>
  {
    const bounds = clampToWorkArea(
      { x: 0, y: 0, w: 700, h: 500 },
      { x: 0, y: 0, width: 200, height: 120 }
    );
    expect(bounds.w).toBe(MIN_DIALOG_WIDTH);
    expect(bounds.h).toBe(MIN_DIALOG_HEIGHT);
  });

  it('pulls a window back from off the right edge, leaving a strip to grab', () =>
  {
    const bounds = clampToWorkArea({ x: 9000, y: 200, w: 700, h: 500 }, AREA);
    expect(bounds.x).toBe(AREA.width - 80);
  });

  it('pulls a window back from off the left edge', () =>
  {
    const bounds = clampToWorkArea({ x: -9000, y: 200, w: 700, h: 500 }, AREA);
    expect(bounds.x).toBe(-700 + 80);
  });

  it('never puts a title bar above the work area', () =>
  {
    // Under a menu bar there is nothing left to drag.
    expect(clampToWorkArea({ x: 100, y: -400, w: 700, h: 500 }, AREA).y).toBe(AREA.y);
  });

  it('keeps the footer on screen: nothing hangs off the bottom', () =>
  {
    // A height is never the user's choice, so a `y` that fitted a shorter window is not a
    // position to honour: it is one that puts the buttons under the edge of the screen.
    const bounds = clampToWorkArea({ x: 100, y: 900, w: 700, h: 500 }, AREA);
    expect(bounds.y).toBe(AREA.y + AREA.height - 500);
  });

  it('starts at the top when the window is taller than the display', () =>
  {
    const short = { x: 0, y: 0, width: 900, height: 120 };
    // The minimum height wins over the display, so the overflow goes at the bottom rather
    // than over the title bar.
    expect(clampToWorkArea({ x: 0, y: 40, w: 700, h: 500 }, short)).toMatchObject({
      y: 0,
      h: MIN_DIALOG_HEIGHT
    });
  });

  it('keeps a window on a display whose origin is not zero', () =>
  {
    const second = { x: -1600, y: 0, width: 1600, height: 1000 };
    expect(clampToWorkArea({ x: -1500, y: 100, w: 700, h: 500 }, second)).toEqual({
      x: -1500,
      y: 100,
      w: 700,
      h: 500
    });
  });
});

describe('placeInWorkArea', () =>
{
  it('leaves bounds that fit alone', () =>
  {
    const bounds = { x: 100, y: 100, w: 700, h: 500 };
    expect(placeInWorkArea(bounds, AREA)).toEqual(bounds);
  });

  it('pulls the whole window back on screen, sideways as well as down', () =>
  {
    // Nobody chose this spot, so there is no preference to honour, and the footer's
    // buttons are at its right-hand end, so hanging off the side loses them too.
    expect(placeInWorkArea({ x: 1400, y: 900, w: 700, h: 500 }, AREA)).toEqual({
      x: AREA.width - 700,
      y: AREA.y + AREA.height - 500,
      w: 700,
      h: 500
    });
  });
});

describe('storedBounds', () =>
{
  it('answers null for a dialog nobody has opened', () =>
  {
    // Null is not a position: it means "wherever a new window goes", which is centred
    // on the parent and no stored pair can say.
    expect(storedBounds({}, 'branch.checkout', AREA)).toBeNull();
  });

  it('fits what it answers to the display it is about to appear on', () =>
  {
    const record = { 'branch.checkout': { x: 9000, y: 9000, w: 3000, h: 2000 } };
    expect(storedBounds(record, 'branch.checkout', AREA)).toEqual({
      x: AREA.width - 80,
      y: AREA.y,
      w: AREA.width,
      h: AREA.height
    });
  });
});

describe('centredOn', () =>
{
  it('centres a dialog on the window that opened it', () =>
  {
    const parent = { x: 200, y: 100, width: 1200, height: 800 };
    expect(centredOn(parent, { w: 520, h: 420 }, AREA)).toEqual({
      x: 200 + (1200 - 520) / 2,
      y: 100 + (800 - 420) / 2,
      w: 520,
      h: 420
    });
  });

  it('keeps the whole window on screen when the parent hangs off the edge', () =>
  {
    // The repository window can be dragged mostly off the bottom of the display; a dialog
    // centred on where it is would take its footer out there with it.
    const parent = { x: 1500, y: 800, width: 1200, height: 800 };
    const bounds = centredOn(parent, { w: 520, h: 420 }, AREA);
    expect(bounds.x).toBe(AREA.width - 520);
    expect(bounds.y).toBe(AREA.y + AREA.height - 420);
  });
});

describe('grownDialogHeight', () =>
{
  it('gives a first measurement its headroom', () =>
  {
    expect(grownDialogHeight(null, 300)).toBe(300 + DIALOG_HEADROOM_PX);
  });

  it('rounds up, so a fractional measurement never lands a pixel short', () =>
  {
    expect(grownDialogHeight(null, 300.4)).toBe(301 + DIALOG_HEADROOM_PX);
  });

  it('is the same strip however tall the form is', () =>
  {
    // A proportion punished exactly the forms with no room to spare: half again over a
    // 660px form is 330px of empty space, on a display that has nothing like it left.
    const empty = (content: number): number => grownDialogHeight(null, content) - content;
    expect(empty(660)).toBe(empty(220));
  });

  it('holds still for content that fits the room it has: the whole point', () =>
  {
    // Browsing the submodules: "All submodules" is a paragraph, one submodule is three
    // fields and a row of buttons, and neither may move the window.
    expect(grownDialogHeight(450, 260)).toBe(450);
    expect(grownDialogHeight(450, 378 - DIALOG_HEADROOM_PX)).toBe(450);
  });

  it('grows for content that does not fit, and keeps the new room', () =>
  {
    // Taller than the floor by more than the strip, so the case is a grow whatever the
    // strip is worth: written the other way it stops testing anything the day it shrinks.
    const content = 450 + DIALOG_HEADROOM_PX + 20;
    expect(grownDialogHeight(450, content)).toBe(content + DIALOG_HEADROOM_PX);
  });

  it('never shrinks, however far the content falls', () =>
  {
    let height: number | null = null;
    const seen = [300, 180, 240, 90, 260].map(
      (content) => (height = grownDialogHeight(height, content))
    );
    expect(seen).toEqual(new Array(5).fill(300 + DIALOG_HEADROOM_PX));
  });
});
