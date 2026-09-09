/**
 * Porcelain parsers: NUL-delimited (except blame/fsck with no `-z` mode).
 * Exceptions: blame/fsck newline-delimited by necessity; grep (half-exception).
 * Pure functions split by command; re-exported here for single import.
 */

export * from './parse/common.js';
export * from './parse/status.js';
export * from './parse/log.js';
export * from './parse/refs.js';
export * from './parse/remotes.js';
export * from './parse/stash.js';
export * from './parse/worktrees.js';
export * from './parse/submodules.js';
export * from './parse/diffRaw.js';
export * from './parse/tree.js';
export * from './parse/blame.js';
export * from './parse/grep.js';
export * from './parse/fsck.js';
