/**
 * The revision grid's real rows.
 *
 * `.probe` is excluded because it is not one: the grid keeps a hidden row of its own to
 * measure a row's height with, so a bare `.grid .row` matches a thing that is
 * `aria-hidden` and never visible, and every wait for "the grid has rows" would resolve
 * to it and then time out on visibility.
 */
export const GRID_ROW = '.grid .row:not(.probe)';
