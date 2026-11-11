/**
 * Moving a directory to the Trash: a rename, so it costs the same whatever is inside,
 * where deleting it costs a system call per file. That difference is the whole reason a
 * worktree is trashed rather than removed: `git worktree remove` deletes file by file,
 * and a worktree with its dependencies installed is hundreds of thousands of files.
 *
 * A driven run never touches the real Trash: a test suite that removes worktrees would
 * fill it. It moves into a directory under the temp folder instead, which is the same
 * rename and leaves nothing behind for anyone to empty.
 */

import { shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { backgroundLaunch } from './background.js';

const DRIVEN_TRASH = 'gitext-driven-trash';

export async function moveToTrash(target: string): Promise<void>
{
  if (!backgroundLaunch)
  {
    await shell.trashItem(target);
    return;
  }
  const bin = path.join(os.tmpdir(), DRIVEN_TRASH);
  await fs.mkdir(bin, { recursive: true });
  await fs.rename(target, path.join(bin, `${Date.now()}-${path.basename(target)}`));
}
