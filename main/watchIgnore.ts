/**
 * What a watch over a git directory skips: churn that is no repository state, and
 * anything `fs.watch` cannot watch at all.
 */

import { existsSync, type Stats } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Directories that churn without UI meaning. `fsmonitor--daemon` holds the cookie files
 * a repo on `core.fsmonitor` writes to prove its daemon is alive and caught up: one per
 * query, so a busy repo rewrites it constantly and none of it is repository state.
 */
const IGNORED_DIRECTORIES = ['objects', 'lfs', 'fsmonitor--daemon'];

/** Files that churn. */
const IGNORED_FILES = ['COMMIT_EDITMSG', 'fsmonitor--daemon.ipc'];

const LOCK_SUFFIX = '.lock';

/**
 * The directories a git directory keeps other git directories in: a linked worktree's at
 * `worktrees/<name>`, a submodule's at `modules/<name>`, where a submodule's name is its
 * path by default and so may run to several segments.
 */
const NESTED_GIT_DIR_PARENTS = ['worktrees', 'modules'];

/** A git directory is a directory with a `HEAD` in it, which is how git recognises one too. */
const GIT_DIR_MARKER = 'HEAD';

/** Is the directory at this absolute path a git directory. */
export type IsGitDir = (path: string) => boolean;

/**
 * How many leading segments of a path lie above the innermost git directory holding it.
 * Watching a git directory watches every git directory nested in it, and churn in one of
 * those is churn only when read against its own root.
 */
function nestedGitDirDepth(gitDir: string, segments: readonly string[], isGitDir: IsGitDir): number
{
  let depth = 0;
  for (;;)
  {
    const next = nestedGitDirEnd(gitDir, segments, depth, isGitDir);
    if (next === null)
    {
      return depth;
    }
    depth = next;
  }
}

/** Where the git directory nested directly under the one ending at `depth` ends, if any. */
function nestedGitDirEnd(
  gitDir: string,
  segments: readonly string[],
  depth: number,
  isGitDir: IsGitDir
): number | null
{
  if (!NESTED_GIT_DIR_PARENTS.includes(segments[depth] ?? ''))
  {
    return null;
  }
  // The name takes at least one segment, and a path that ends at the directory itself
  // names nothing inside it.
  for (let end = depth + 2; end < segments.length; end++)
  {
    if (isGitDir(join(gitDir, ...segments.slice(0, end))))
    {
      return end;
    }
  }
  return null;
}

/**
 * Is path churn (relative to gitDir). Submodules/worktrees have different
 * git dir paths; pattern must handle all.
 */
export function isChurn(gitDir: string, path: string, isGitDir: IsGitDir): boolean
{
  const inside = relative(gitDir, path);
  if (inside === '' || inside.startsWith('..'))
  {
    return false;
  }
  const segments = inside.split(sep);
  const own = segments.slice(nestedGitDirDepth(gitDir, segments, isGitDir));
  const [top = ''] = own;
  return (
    IGNORED_DIRECTORIES.includes(top) ||
    inside.endsWith(LOCK_SUFFIX) ||
    (own.length === 1 && IGNORED_FILES.includes(top))
  );
}

/**
 * Is path churn to any of the directories being watched. A linked worktree's git
 * directory sits *inside* the shared one, so a path can be read against either; churn to
 * one is churn, since the two views disagree only about how much of the path they see.
 */
export function isChurnIn(gitDirs: readonly string[], path: string, isGitDir: IsGitDir): boolean
{
  return gitDirs.some((gitDir) => isChurn(gitDir, path, isGitDir));
}

/**
 * Can `fs.watch` watch this. A socket or a FIFO is neither a file nor a directory, and
 * watching one fails outright with `UNKNOWN` rather than quietly watching nothing: the
 * fsmonitor daemon listens on a socket in every git directory it serves. A symbolic link
 * is resolved by the watcher itself, so it passes here.
 */
export function isWatchable(stats: Stats): boolean
{
  return stats.isFile() || stats.isDirectory() || stats.isSymbolicLink();
}

/**
 * A git-directory probe that remembers what it has found. Only a hit is kept: a miss can
 * be a worktree `git worktree add` is still writing, which is a git directory a moment
 * later.
 */
export function cachedGitDirProbe(): IsGitDir
{
  const known = new Set<string>();
  return (path) =>
  {
    if (known.has(path))
    {
      return true;
    }
    if (!existsSync(join(path, GIT_DIR_MARKER)))
    {
      return false;
    }
    known.add(path);
    return true;
  };
}

/**
 * What the watcher skips under `targets`: churn, and anything that cannot be watched.
 * The watcher asks before it has looked at a path as well as after, so `stats` is
 * sometimes absent, and then only the path can decide.
 */
export function ignoredUnder(targets: readonly string[], isGitDir: IsGitDir): (path: string, stats?: Stats) => boolean
{
  return (path, stats) =>
  {
    if (stats && !isWatchable(stats))
    {
      return true;
    }
    return isChurnIn(targets, path, isGitDir);
  };
}
