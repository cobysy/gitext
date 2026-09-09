/**
 * Repository housekeeping not a git command. Removing `.git/index.lock`
 * that git left behind.
 */

import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveGitDir } from './repo.js';

const INDEX_LOCK_FILE = 'index.lock';

/**
 * Delete `.git/index.lock`. Survives when git process died. Returns whether
 * one was there. Can't detect running vs dead git.
 */
export async function deleteIndexLock(repoPath: string): Promise<boolean>
{
  const lock = join(await resolveGitDir(repoPath), INDEX_LOCK_FILE);

  // stat before rm: force: true swallows missing file, must tell them apart.
  const existed = await stat(lock).then(
    () => true,
    () => false
  );

  await rm(lock, { force: true });
  return existed;
}
