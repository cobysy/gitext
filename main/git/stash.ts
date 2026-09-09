/**
 * Stash list. Explicitly marked as read (not inferred) so background refreshes don't
 * take index.lock.
 */

import type { StashEntry } from '@shared/types.js';
import { STASH_FORMAT, parseStashList } from './parse.js';
import { GIT_KIND_READ, tryGit } from './runner.js';

const CMD_STASH = 'stash';
const SUBCOMMAND_LIST = 'list';
const FLAG_NUL_TERMINATED = '-z';

export function buildStashListArgs(): string[]
{
  return [CMD_STASH, SUBCOMMAND_LIST, FLAG_NUL_TERMINATED, `--format=${STASH_FORMAT}`];
}

export async function listStashes(repoPath: string): Promise<StashEntry[]>
{
  // Unborn repos have no reflog: treat as no stashes, not an error.
  const out = await tryGit(repoPath, buildStashListArgs(), { kind: GIT_KIND_READ });
  if (out)
  {
    return parseStashList(out);
  }
  else
  {
    return [];
  }
}
