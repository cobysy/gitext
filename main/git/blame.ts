/**
 * Blame one file: who wrote each line. Dialog previews argv;
 * command log shows it.
 */

import { ENDPOINT_KIND_COMMIT, type DiffEndpoint } from '@shared/diff.js';
import type { BlameFile } from '@shared/types.js';
import { parseBlame } from './parse.js';
import { GIT_KIND_READ, runGit } from './runner.js';

const CMD_BLAME = 'blame';
const FLAG_PORCELAIN = '--porcelain';
const FLAG_IGNORE_WHITESPACE = '-w';
const FLAG_LONG_HASH = '-l';
const PATH_SEPARATOR = '--';

/**
 * The argv for blaming `path` as of `revision`.
 *
 * `revision: null` (and the two artificial endpoints) blame the **working tree**, bare
 * `git blame` with no revision argument, which is what makes an uncommitted edit come
 * back as git's own "Not Committed Yet" sentinel rather than being attributed to
 * whichever commit last touched the line on disk. That distinction matters here more
 * than most places `DiffEndpoint` appears: the most common way into this dialog is the
 * changed-files list, where the selected row is the working tree as often as it is a
 * historical commit.
 *
 * `-w` ignores whitespace-only changes when attributing a line; `-l` forces long
 * (40-character) hashes, which is what `parseBlame`'s header regex expects.
 */
export function buildBlameArgs(revision: DiffEndpoint | null, path: string): string[]
{
  const args = [CMD_BLAME, FLAG_PORCELAIN, FLAG_IGNORE_WHITESPACE, FLAG_LONG_HASH];
  if (revision?.kind === ENDPOINT_KIND_COMMIT)
  {
    args.push(revision.sha);
  }
  args.push(PATH_SEPARATOR, path);
  return args;
}

/** Blame `path` as of `revision`, or the working tree when `revision` is null. */
export async function readBlame(
  repoPath: string,
  revision: DiffEndpoint | null,
  path: string
): Promise<BlameFile>
{
  const out = await runGit(repoPath, buildBlameArgs(revision, path), { kind: GIT_KIND_READ });
  return parseBlame(out, path);
}
