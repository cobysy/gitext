/**
 * Searching file contents with `git grep`.
 *
 * The read behind the Find in Files dialog. The argv is `shared/grep.ts`'s, not this
 * file's, because the dialog previews the same array before this runs it: see that
 * file's doc comment for why the builder lives over there rather than in
 * `renderer/model/args/` like every other dialog's.
 */

import { GREP_HIT_LIMIT, buildGrepArgs, grepPathPrefix, type GrepOptions, type GrepResult } from '@shared/grep.js';
import { parseGrep } from './parse.js';
import { GIT_KIND_READ, GitError, runGit } from './runner.js';


/** Exit code 1 means "no matches" (not failure): catch it, not allowFailure (which silences real errors). */
export async function searchGrep(repoPath: string, options: GrepOptions): Promise<GrepResult>
{
  let out: string;
  try
  {
    out = await runGit(repoPath, buildGrepArgs(options), { kind: GIT_KIND_READ });
  }
  catch (err)
  {
    if (err instanceof GitError && err.exitCode === 1)
    {
      return { hits: [], truncated: false };
    }
    throw err;
  }

  const { hits, truncated } = parseGrep(out, {
    pathPrefix: grepPathPrefix(options.endpoint),
    limit: GREP_HIT_LIMIT
  });
  return { hits, truncated };
}
