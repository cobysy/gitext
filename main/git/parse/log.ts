import {
  REF_KIND_BRANCH,
  REF_KIND_HEAD,
  REF_KIND_REMOTE,
  REF_KIND_STASH,
  REF_KIND_TAG,
  type CommitRef,
  type CommitRow
} from '@shared/types.js';
import { parseParents } from '@shared/parents.js';

/**
 * Fields from `git log`, NUL-separated. Safe because commit objects can't contain NUL.
 */
export const LOG_FORMAT_FIELDS = [
  '%H', // sha
  '%P', // parents, space separated
  '%an',
  '%aE',
  '%at', // author date, unix seconds
  '%cn',
  '%cE',
  '%ct',
  '%D', // ref names, comma separated, no wrapping parens
  '%s', // subject
  '%b', // body after the subject
  '%N' // note, empty unless --notes was passed
] as const;

export const LOG_FORMAT = LOG_FORMAT_FIELDS.join('%x00');

const LOG_FIELD_COUNT = LOG_FORMAT_FIELDS.length;

const HEAD_ARROW_PREFIX = 'HEAD -> ';
const HEAD_NAME = 'HEAD';
const TAG_PREFIX = 'tag: ';
const STASH_PREFIX = 'refs/stash';

/**
 * Decode one entry of `%D`. Remote list needed to distinguish `origin/main` from local branch with slash.
 */
function parseRef(entry: string, remotes: readonly string[]): CommitRef
{
  const text = entry.trim();

  if (text.startsWith(HEAD_ARROW_PREFIX))
  {
    return { name: text.slice(HEAD_ARROW_PREFIX.length), kind: REF_KIND_BRANCH, isCurrent: true };
  }
  if (text === HEAD_NAME)
  {
    return { name: HEAD_NAME, kind: REF_KIND_HEAD, isCurrent: true };
  }
  if (text.startsWith(TAG_PREFIX))
  {
    return { name: text.slice(TAG_PREFIX.length), kind: REF_KIND_TAG, isCurrent: false };
  }
  if (text.startsWith(STASH_PREFIX))
  {
    return { name: text, kind: REF_KIND_STASH, isCurrent: false };
  }

  const remote = remotes.find((r) => text.startsWith(`${r}/`));
  let kind: typeof REF_KIND_REMOTE | typeof REF_KIND_BRANCH;
  if (remote)
  {
    kind = REF_KIND_REMOTE;
  }
  else
  {
    kind = REF_KIND_BRANCH;
  }
  return { name: text, kind, isCurrent: false };
}

function parseRefs(field: string, remotes: readonly string[]): CommitRef[]
{
  if (!field)
  {
    return [];
  }
  return field
    .split(', ')
    .filter(Boolean)
    .map((entry) => parseRef(entry, remotes));
}

function toCommit(fields: string[], remotes: readonly string[]): CommitRow
{
  const at = (i: number): string => fields[i] ?? '';
  return {
    sha: at(0),
    parents: parseParents(at(1)),
    authorName: at(2),
    authorEmail: at(3),
    authorDate: Number(at(4)) || 0,
    committerName: at(5),
    committerEmail: at(6),
    committerDate: Number(at(7)) || 0,
    refs: parseRefs(at(8), remotes),
    subject: at(9),
    body: at(10).trimEnd(),
    note: at(11).trimEnd()
  };
}

/**
 * Incremental parser for `git log -z --format=LOG_FORMAT`.
 *
 * Fed raw stdout chunks as they arrive and yields whole commits, holding back the
 * partial record at the tail. This is what lets the first screenful render while git
 * is still walking a 50k-commit history: the alternative is buffering the whole
 * output, which costs seconds of blank window.
 *
 * Pure: no git, no I/O, so the chunk-boundary cases are ordinary unit tests.
 */
export class LogParser
{
  private buffer = '';
  private fields: string[] = [];

  constructor(private readonly remotes: readonly string[] = [])
  {}

  /** Consume a chunk and return every commit it completed. */
  push(chunk: string): CommitRow[]
  {
    this.buffer += chunk;
    const commits: CommitRow[] = [];

    let start = 0;
    for (;;)
    {
      const nul = this.buffer.indexOf('\0', start);
      if (nul === -1)
      {
        break;
      }

      this.fields.push(this.buffer.slice(start, nul));
      start = nul + 1;

      if (this.fields.length === LOG_FIELD_COUNT)
      {
        commits.push(toCommit(this.fields, this.remotes));
        this.fields = [];
      }
    }

    this.buffer = this.buffer.slice(start);
    return commits;
  }

  /**
   * Finish up, returning a trailing commit if git omitted the final NUL.
   *
   * Only reachable when the last field is empty and unterminated; a well-formed
   * stream leaves nothing behind.
   */
  flush(): CommitRow[]
  {
    if (this.buffer.length > 0)
    {
      this.fields.push(this.buffer);
    }
    this.buffer = '';

    if (this.fields.length === 0)
    {
      return [];
    }

    // A truncated record is not a commit: dropping it beats inventing one.
    const complete = this.fields.length === LOG_FIELD_COUNT;
    let commits: CommitRow[];
    if (complete)
    {
      commits = [toCommit(this.fields, this.remotes)];
    }
    else
    {
      commits = [];
    }
    this.fields = [];
    return commits;
  }
}

/** Parse a complete `git log -z` payload in one go. */
export function parseLog(text: string, remotes: readonly string[] = []): CommitRow[]
{
  const parser = new LogParser(remotes);
  return [...parser.push(text), ...parser.flush()];
}
