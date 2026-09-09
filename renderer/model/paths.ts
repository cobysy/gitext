/**
 * Path within repository as a branded type. Prevents confusion with other strings.
 * Brand only at boundaries (parsers, IPC results); casting from plain strings only via toFilePath.
 */
export type FilePath = string & { readonly __brand: 'FilePath' };

export function toFilePath(path: string): FilePath
{
  return path as FilePath;
}

export function toFilePaths(paths: readonly string[]): FilePath[]
{
  return paths.map(toFilePath);
}

/**
 * Path relative to repo root (for worktree links and command previews).
 * Falls back to absolute if too deep or unrelated; normalizes backslashes.
 */
export function toRepoRelative(repoRoot: string, target: string): string
{
  const split = (path: string): string[] =>
    path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter((part) => part.length > 0);

  const from = split(repoRoot);
  const to = split(target);
  if (from.length === 0 || to.length === 0)
  {
    return target.replace(/\\/g, '/');
  }

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared])
  {
    shared++;
  }
  // Different roots: keep absolute path.
  if (shared === 0)
  {
    return target.replace(/\\/g, '/');
  }

  const up = from.length - shared;
  // More than two levels up: use absolute instead.
  if (up > 2)
  {
    return target.replace(/\\/g, '/');
  }

  const parts = [...Array.from({ length: up }, () => '..'), ...to.slice(shared)];
  if (parts.length)
  {
    return parts.join('/');
  }
  else
  {
    return '.';
  }
}

/** A path the OS can act on: rooted, and separated the way `repoRoot` is separated. */
const ABSOLUTE_PATH = /^(?:\/|\\\\|[A-Za-z]:[\\/])/;

/**
 * The inverse of `toRepoRelative`: a path from git, joined onto the repository it came
 * from so the OS can open it.
 *
 * Git answers in repo-relative paths and the panel carries both kinds: a worktree is
 * somewhere else on disk and so absolute, a submodule is a directory inside the
 * repository and so relative. An already-rooted path is returned untouched, which is
 * what lets one helper serve both without the caller knowing which it holds.
 */
export function toNativePath(repoRoot: string, path: string): string
{
  if (ABSOLUTE_PATH.test(path))
  {
    return path;
  }
  if (repoRoot.includes('\\'))
  {
    return `${repoRoot}\\${path.replaceAll('/', '\\')}`;
  }
  else
  {
    return `${repoRoot}/${path}`;
  }
}
