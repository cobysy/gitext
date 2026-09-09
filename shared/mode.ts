/**
 * Git modes for special entries. Shared (not in tree.ts) because both file lists use them
 * but neither can import the other: tree entries have git's mode, changed files have
 * `--raw` mode, and they need a common place to decode them.
 */

/** Mode for a submodule (gitlink). */
export function isSubmoduleMode(mode: string): boolean
{
  return mode === '160000';
}

/** Mode for a symbolic link. */
export function isSymlinkMode(mode: string): boolean
{
  return mode === '120000';
}

/** Mode for a regular file with executable bit set. */
export function isExecutableMode(mode: string): boolean
{
  return mode === '100755';
}
