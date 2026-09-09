/**
 * Git's own message files: `MERGE_MSG`, `COMMIT_EDITMSG`, and the rest a stopped
 * operation leaves behind for the editor it would have opened.
 *
 * The app writes the file and then runs `commit -F <path>`, never `commit -m <message>`:
 * `-m` leaves git's generated file untouched, so resuming the operation later picks up a
 * message the user has already replaced. Writing the file *is* the edit.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MessageFileName } from '@shared/types.js';
import { resolveGitDir } from './repo.js';
import { ENCODING_UTF8 } from './runner.js';

const NEWLINE = '\n';

/** Per-worktree, not the shared `.git`: a linked worktree stops mid-operation on its own. */
async function messageFilePath(repoPath: string, name: MessageFileName): Promise<string>
{
  return join(await resolveGitDir(repoPath), name);
}

/** The file's contents, or `''` when it is absent: outside an operation, absent is normal. */
export async function readMessageFile(
  repoPath: string,
  name: MessageFileName
): Promise<string>
{
  try
  {
    return await readFile(await messageFilePath(repoPath, name), ENCODING_UTF8);
  }
  catch
  {
    return '';
  }
}

/** Writes the file and returns its absolute path, which the argv preview shows after `-F`. */
export async function writeMessageFile(
  repoPath: string,
  name: MessageFileName,
  message: string
): Promise<string>
{
  const path = await messageFilePath(repoPath, name);
  // A trailing newline, the way git writes one itself.
  let contents: string;
  if (message.endsWith(NEWLINE))
  {
    contents = message;
  }
  else
  {
    contents = `${message}${NEWLINE}`;
  }
  await writeFile(path, contents, ENCODING_UTF8);
  return path;
}
