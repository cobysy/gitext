/**
 * Parse unified diff to viewer rows (line numbers, hunks, side-by-side pairing).
 * Pure, testable; renderer parses (what crosses IPC is git's output text).
 */

export * from './patch/types.js';
export * from './patch/parse.js';
export * from './patch/align.js';
export * from './patch/inlineDiff.js';
