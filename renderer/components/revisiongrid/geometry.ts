/**
 * Graph gutter geometry, shared by the canvas that draws the lanes and the grid that
 * reserves room for them: both do arithmetic with these every frame, so they're
 * TypeScript constants rather than CSS custom properties, and live here so the two agree.
 */

import type { GraphLineWidth } from '@shared/types.js';

/** Column pitch, in CSS pixels. Unscaled: the browser handles DPI scaling itself. */
export const LANE_WIDTH = 16;

/**
 * Stroke width of a lane line, in CSS pixels, by `Settings.graphLineWidth`. A rendering
 * choice, not a layout one: it never reaches `buildGraph`, so changing it redraws the
 * same lanes without laying them out again.
 */
export const LANE_LINE_WIDTHS: Record<GraphLineWidth, number> = {
  light: 1,
  normal: 2,
  heavy: 3
};

/** Node diameter, so radius 4: sized to sit with this grid's text and its 24px rows. */
export const NODE_DIMENSION = 8;

/** Blank space before lane 0, in CSS pixels. */
export const COLUMN_LEFT_MARGIN = 3;

/**
 * Widest gutter the graph may occupy, in lanes. Lanes past this are **not drawn at
 * all**, rather than stacked into the last column: stacking makes whichever line is
 * stroked last silently paint over another branch's colour in that column, which reads
 * as a colouring bug rather than the missing room it actually is. The gutter is measured
 * from the rows actually on screen, so a cap this high costs nothing until a history is
 * wide enough to need it.
 */
export const MAX_LANES = 40;

/** Gutter width for a region whose widest row occupies `laneCount` lanes. */
export function gutterWidth(laneCount: number): number
{
  return COLUMN_LEFT_MARGIN + Math.min(laneCount, MAX_LANES) * LANE_WIDTH;
}

/**
 * Centre of a lane, in CSS pixels from the left of the gutter. Truncated to a whole
 * pixel so a vertical line lands on the pixel grid and reads crisp at any zoom; the
 * curve maths downstream stays unrounded.
 */
export function laneX(lane: number): number
{
  return COLUMN_LEFT_MARGIN + Math.trunc((lane + 0.5) * LANE_WIDTH);
}
