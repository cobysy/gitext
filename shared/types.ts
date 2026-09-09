/**
 * Domain types shared across IPC. Must be structured-clone-safe. Barrel over
 * shared/types/ split by domain so consumers' imports don't change.
 */

export * from './types/commandLog.js';
export * from './types/settings.js';
export * from './types/repo.js';
export * from './types/commits.js';
export * from './types/refs.js';
export * from './types/status.js';
export * from './types/blame.js';
export * from './types/objects.js';
export * from './types/config.js';
export * from './types/conflicts.js';
