/**
 * Revision-graph layout: commits in, rows of lanes out. Pure, DOM-free, and all the
 * canvas in `components/revisiongrid/` is given.
 */

export { markAncestry, markRelative } from './ancestry.js';
export type { GraphConfig } from './config.js';
export { DEFAULT_GRAPH_CONFIG } from './config.js';
export { OpenLines } from './lanes.js';
export type { OpenLine } from './lanes.js';
export { buildGraph } from './layout.js';
export { GRAPH_COLOR_COUNT, hashSha, NO_COLOR, pickColor } from './palette.js';
export type { GraphInputCommit, GraphLine, GraphRow } from './types.js';
