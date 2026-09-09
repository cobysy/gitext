/** SHA abbreviation: shared (patch reader uses it) so submodule diffs match grid. */

/** Fixed abbreviation length (not per-repo): SHA column must line up. */
export const SHORT_SHA_LENGTH = 8;

export function shortSha(sha: string): string
{
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/** git's own name for the current commit: the revision every dialog defaults to. */
export const HEAD_REF = 'HEAD';
