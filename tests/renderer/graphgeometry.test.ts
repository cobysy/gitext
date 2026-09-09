import { describe, expect, it } from 'vitest';
import {
  COLUMN_LEFT_MARGIN,
  gutterWidth,
  laneX,
  LANE_LINE_WIDTHS,
  LANE_WIDTH,
  MAX_LANES
} from '@renderer/components/revisiongrid/geometry.js';

describe('graph gutter geometry', () =>
{
  it('gives every lane a column of its own, after a leading margin', () =>
  {
    // A *leading* margin. A
    // trailing `LANE_WIDTH` instead puts every lane one column left of where GE puts it.
    expect(gutterWidth(1)).toBe(COLUMN_LEFT_MARGIN + LANE_WIDTH);
    expect(gutterWidth(5)).toBe(COLUMN_LEFT_MARGIN + 5 * LANE_WIDTH);
  });

  it('stops widening at the cap', () =>
  {
    // A history wider than the gutter must not push the commit message off screen.
    expect(gutterWidth(MAX_LANES + 20)).toBe(gutterWidth(MAX_LANES));
  });

  it('is wide enough for the histories that produced the overflow bug', () =>
  {
    // The repository that surfaced the clamp peaked at 21 concurrent lanes and was
    // over the old cap of 14 on 77% of its rows. A cap that ordinary histories exceed
    // routinely is not a safety valve, it is the normal path.
    expect(MAX_LANES).toBeGreaterThanOrEqual(21);
  });

  it('centres a lane on the pixel grid', () =>
  {
    // The truncation is deliberate: this is where a lane index becomes a pixel, and a
    // whole pixel is what makes a vertical line read crisp at any zoom.
    for (const lane of [0, 1, 7, 39])
    {
      expect(laneX(lane)).toBe(COLUMN_LEFT_MARGIN + Math.trunc((lane + 0.5) * LANE_WIDTH));
    }
  });

  it('keeps every lane centre inside the gutter it sizes', () =>
  {
    // The two functions have to agree, or the lines land beside the space kept for them.
    for (let lanes = 1; lanes <= MAX_LANES; lanes++)
    {
      expect(laneX(lanes - 1)).toBeLessThan(gutterWidth(lanes));
    }
  });

  it("is 2px at 'normal', and strictly ordered either side of it", () =>
  {
    // `light` and `heavy` exist to be visibly thinner and thicker than the default, so
    // the ordering is the whole of what the setting promises.
    expect(LANE_LINE_WIDTHS.normal).toBe(2);
    expect(LANE_LINE_WIDTHS.light).toBeLessThan(LANE_LINE_WIDTHS.normal);
    expect(LANE_LINE_WIDTHS.normal).toBeLessThan(LANE_LINE_WIDTHS.heavy);
  });
});
