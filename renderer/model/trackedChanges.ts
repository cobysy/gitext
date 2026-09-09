/**
 * Which of a status listing's files git would actually put in a stash.
 *
 * The distinction the working tree makes and `status.files.length` does not: a plain
 * `stash push` saves tracked changes only, so a tree whose whole "dirtiness" is one
 * untracked directory has nothing for it to save, and running it there costs a
 * subprocess to be told so.
 */

import { FILE_STATUS_IGNORED, FILE_STATUS_UNTRACKED, type FileStatus } from '@shared/types.js';

/** Both sides are read: git reports an untracked path on the worktree side, an assume-unchanged one on neither. */
export function isUntracked(file: FileStatus): boolean
{
  return file.worktree === FILE_STATUS_UNTRACKED || file.index === FILE_STATUS_UNTRACKED;
}

export function isIgnored(file: FileStatus): boolean
{
  return file.worktree === FILE_STATUS_IGNORED || file.index === FILE_STATUS_IGNORED;
}

/**
 * Whether `stash push` would save anything, given whether `-u` is on. Ignored files
 * need `-a`, which nothing here offers, so they never count.
 */
export function hasStashableChanges(
  files: readonly FileStatus[],
  includeUntracked: boolean
): boolean
{
  return files.some((file) =>
  {
    if (isIgnored(file))
    {
      return false;
    }
    if (isUntracked(file))
    {
      return includeUntracked;
    }
    return true;
  });
}
