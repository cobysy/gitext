/**
 * Reading the revision log: the grid's bulk query, whole or streamed.
 *
 * `buildLogArgs` is split out from the running so the grid can show exactly what it
 * is about to run, and so the View menu's toggles are visibly argv flags rather than
 * hidden behaviour (§8). The same array is previewed and executed. Fetching one
 * commit's note for the details pane is a different question, asked in its own
 * subprocess rather than as part of this one: see `commitDetails.ts`.
 */

import type { CommitRow, LogOptions } from '@shared/types.js';
import { LOG_FORMAT, LogParser } from './parse.js';
import { getRemoteNames } from './remote.js';
import { GIT_KIND_READ, runGit, streamGitRaw, tryGit } from './runner.js';

export type { LogOptions };

/**
 * A ref-filter token that names a branch by wildcard, not exact name. `git log
 * <name>` treats a bare name as one exact ref; `--branches=<pattern>` expands
 * `*`/`?`/`[...]`. A literal name through `--branches=` implicitly appends `/*` (matching nothing).
 */
const WILDCARD = /[*?[]/;

const CMD_LOG = 'log';
const CMD_REV_LIST = 'rev-list';
const FLAG_NUL_TERMINATED = '-z';
const FLAG_COUNT = '--count';
const FLAG_NOTES = '--notes';
const FLAG_FOLLOW = '--follow';
const FORMAT_PREFIX = '--format=';

// Log order
const ORDER_TOPO = 'topo';
const ORDER_AUTHOR_DATE = 'author-date';

// Log scope
const SCOPE_ALL = 'all';
const SCOPE_FILTERED = 'filtered';

/** True when any of the message/author/committer text filters is set. */
function hasTextFilter(options: LogOptions): boolean
{
  return !!(options.messageFilter || options.authorFilter || options.committerFilter);
}

/**
 * Build the argv for a log query. Pure and exported so a dialog can preview it, a
 * test can assert it, and the command log shows the same array that ran.
 */
export function buildLogArgs(options: LogOptions = {}): string[]
{
  const args = [CMD_LOG, FLAG_NUL_TERMINATED, `${FORMAT_PREFIX}${LOG_FORMAT}`];

  switch (options.order ?? 'date')
  {
    case ORDER_TOPO:
      args.push('--topo-order');
      break;
    case ORDER_AUTHOR_DATE:
      args.push('--author-date-order');
      break;
    default:
      args.push('--date-order');
  }

  if (options.limit != null)
  {
    args.push(`--max-count=${options.limit}`);
  }
  if (options.firstParentOnly)
  {
    args.push('--first-parent');
  }
  if (options.hideMergeCommits)
  {
    args.push('--no-merges');
  }
  if (options.notes)
  {
    args.push(FLAG_NOTES);
  }

  // Whether anything below has named a revision for git to walk from: git falls back
  // to HEAD only when the argv names *nothing*, and the stash glob further down counts
  // as something even with no stash.
  let namesRevisions = false;

  // Reflog replaces scope flags (has its own ref set).
  if (options.reflog)
  {
    args.push('--reflog');
    namesRevisions = true;
  }
  else if (options.scope === SCOPE_ALL)
  {
    // `--branches`/`--tags`/`--remotes`, not `--all`: `--all` includes `refs/stash`, showing stash commits regardless of the toggle.
    args.push('--branches');
    if (options.includeTags !== false)
    {
      args.push('--tags');
    }
    if (options.includeRemoteBranches !== false)
    {
      args.push('--remotes');
    }
    namesRevisions = true;
  }
  else if (options.scope === SCOPE_FILTERED && options.refs?.length)
  {
    for (const ref of options.refs)
    {
      if (WILDCARD.test(ref))
      {
        args.push(`--branches=${ref}`);
      }
      else
      {
        args.push(ref);
      }
    }
    namesRevisions = true;
  }

  // The current-branch scope, and a filtered one with an empty pattern: say HEAD
  // rather than let git assume it. `--ignore-missing` keeps an unborn branch an empty grid, not a fatal error.
  if (!namesRevisions)
  {
    args.push('--ignore-missing', 'HEAD');
  }

  // `--glob=refs/stas[h]`, not `refs/stash`: bare refs error if empty, globs don't;
  // `[h]` avoids the implicit `/*` on a pattern with no wildcard.
  if (options.includeStashes)
  {
    args.push('--glob=refs/stas[h]');
  }

  if (options.ignoreCase)
  {
    args.push('--regexp-ignore-case');
  }
  // Explicitly set regex mode; don't rely on config defaults.
  if (hasTextFilter(options))
  {
    if (options.useRegex)
    {
      args.push('--extended-regexp');
    }
    else
    {
      args.push('--fixed-strings');
    }
  }
  if (options.messageFilter)
  {
    args.push(`--grep=${options.messageFilter}`);
  }
  if (options.authorFilter)
  {
    args.push(`--author=${options.authorFilter}`);
  }
  if (options.committerFilter)
  {
    args.push(`--committer=${options.committerFilter}`);
  }
  if (options.diffContentFilter)
  {
    args.push(`-S${options.diffContentFilter}`);
  }
  if (options.since)
  {
    args.push(`--since=${options.since}`);
  }
  if (options.until)
  {
    args.push(`--until=${options.until}`);
  }

  // --follow: must come before `--`, only works with exactly one path.
  // Silently processing multiple paths differently is worse than an error.
  if (options.follow)
  {
    if (options.paths?.length !== 1)
    {
      throw new Error('--follow requires exactly one path');
    }
    args.push(FLAG_FOLLOW);
  }

  // Paths after `--` are unambiguous (file named like a ref won't be confused).
  if (options.paths?.length)
  {
    args.push('--', ...options.paths);
  }

  return args;
}

/** Read the whole log in one go. Prefer `streamLog` for anything user-facing. */
export async function readLog(
  repoPath: string,
  options: LogOptions = {}
): Promise<CommitRow[]>
{
  const remotes = await getRemoteNames(repoPath);
  const out = await runGit(repoPath, buildLogArgs(options), { kind: GIT_KIND_READ });
  const parser = new LogParser(remotes);
  return [...parser.push(out), ...parser.flush()];
}

/**
 * Read the log, delivering commits in batches as git produces them, so the grid can
 * paint its first screenful before a large history finishes walking. `cancel` kills
 * the child, so a changed filter doesn't leave the old query running. `done` carries
 * no commits: they've all gone to `onBatch` already, and holding a second copy here
 * would keep the whole history in memory for a caller that wants an array instead
 * uses `readLog`.
 */
export function streamLog(
  repoPath: string,
  options: LogOptions,
  onBatch: (commits: CommitRow[]) => void,
  remotes: readonly string[] = []
): { done: Promise<void>; cancel: () => void }
{
  const parser = new LogParser(remotes);

  const emit = (commits: CommitRow[]): void =>
  {
    if (commits.length === 0)
    {
      return;
    }
    onBatch(commits);
  };

  const { done, cancel } = streamGitRaw(
    repoPath,
    buildLogArgs(options),
    (chunk) => emit(parser.push(chunk)),
    { kind: GIT_KIND_READ }
  );

  return {
    done: done.then(() =>
    {
      emit(parser.flush());
    }),
    cancel
  };
}

/** Count commits a query would return, without reading them: the "showing N of M" affordance when a limit is in force. */
export async function countCommits(repoPath: string, options: LogOptions = {}): Promise<number>
{
  const args = buildLogArgs({ ...options, limit: null });
  // Swap the log formatting for a bare count over the same ref selection.
  const revListArgs = [CMD_REV_LIST, FLAG_COUNT, ...args.slice(1).filter((a) => !isFormatting(a))];
  const out = await tryGit(repoPath, revListArgs);
  return Number(out?.trim()) || 0;
}

function isFormatting(arg: string): boolean
{
  return arg === FLAG_NUL_TERMINATED || arg.startsWith(FORMAT_PREFIX) || arg === FLAG_NOTES;
}
