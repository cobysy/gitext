/**
 * `%P`: a commit's parents, as git prints them.
 *
 * One field, space-separated, and empty for a root commit. Four readers had each
 * worked that out for themselves and reached three different answers: one split on a
 * single space and kept the empty string a root commit produces, one guarded the split
 * with a `trim()` test, one split on any run of whitespace. A root commit with no
 * parents and a merge with two are the cases, and they are the same cases everywhere.
 *
 * In `shared/` because both sides read the field: `main/git/` parses git's output, and
 * `renderer/model/lostObject.ts` parses the `git show` it asks for itself.
 */

/** The parent SHAs, oldest-first as git ordered them. Empty for a root commit. */
export function parseParents(field: string): string[]
{
  return field.trim().split(/\s+/).filter((sha) => sha.length > 0);
}
