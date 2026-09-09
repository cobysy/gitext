/**
 * `git log` preview argv (mirror of main/git/log.ts): log travels as LogOptions data,
 * not literal argv, so renderer must mirror it. Only dialog-settable fields mirrored.
 */

import type { LogOptions } from '@shared/types.js';

const WILDCARD = /[*?[]/;

const SCOPE_ALL = 'all';
const SCOPE_FILTERED = 'filtered';

/** True when any of the message/author/committer text filters is set. */
function hasTextFilter(options: LogOptions): boolean
{
  return !!(options.messageFilter || options.authorFilter || options.committerFilter);
}

export function buildLogFilterArgs(options: LogOptions): string[]
{
  const args: string[] = [];

  if (options.firstParentOnly)
  {
    args.push('--first-parent');
  }
  if (options.hideMergeCommits)
  {
    args.push('--no-merges');
  }

  if (options.reflog)
  {
    args.push('--reflog');
  }
  else if (options.scope === SCOPE_ALL)
  {
    args.push('--branches');
    if (options.includeTags !== false)
    {
      args.push('--tags');
    }
    if (options.includeRemoteBranches !== false)
    {
      args.push('--remotes');
    }
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
  }

  if (options.includeStashes)
  {
    args.push('--glob=refs/stas[h]');
  }

  if (options.ignoreCase)
  {
    args.push('--regexp-ignore-case');
  }
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

  return args;
}
