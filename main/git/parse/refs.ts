import { OBJECT_KIND_TAG, REF_KIND_REMOTE, type RefEntry } from '@shared/types.js';

// Upstream tracking status
const UPSTREAM_GONE = 'gone';
const CURRENT_BRANCH_MARKER = '*';

/**
 * git for-each-ref fields. *-prefixed describe annotated tags (empty for lightweight).
 * Example: refname | type | sha | tagged-sha | date | tagged-date | upstream | track | current.
 */
export const REF_FORMAT_FIELDS = [
  '%(refname)',
  '%(objecttype)', // 'tag' only for an annotated tag; 'commit' otherwise
  '%(objectname)',
  '%(*objectname)', // the tagged commit, for an annotated tag
  '%(committerdate:unix)',
  '%(*committerdate:unix)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)', // e.g. "ahead 1, behind 2" or "gone"
  '%(HEAD)' // '*' for the checked-out branch, ' ' otherwise
] as const;

/**
 * Use %00, not %x00: for-each-ref doesn't use the `x` that log requires.
 */
export const REF_FORMAT = REF_FORMAT_FIELDS.join('%00');

const REF_PREFIXES = {
  branch: 'refs/heads/',
  remote: 'refs/remotes/',
  tag: 'refs/tags/'
} as const;

function refKind(fullName: string): RefEntry['kind'] | null
{
  for (const [kind, prefix] of Object.entries(REF_PREFIXES))
  {
    if (fullName.startsWith(prefix))
    {
      return kind as RefEntry['kind'];
    }
  }
  return null;
}

/**
 * Extract remote from `origin/feature/x`. Longest match wins; falls back to first segment.
 */
function remoteOf(name: string, remotes: readonly string[]): string
{
  let best = '';
  for (const remote of remotes)
  {
    if (name.startsWith(`${remote}/`) && remote.length > best.length)
    {
      best = remote;
    }
  }
  return best || name.slice(0, name.indexOf('/'));
}

/** Decode upstream tracking status: "ahead 3, behind 1" or "gone" or empty. */
function parseUpstreamTrack(track: string): { ahead: number; behind: number; gone: boolean }
{
  if (track === UPSTREAM_GONE)
  {
    return { ahead: 0, behind: 0, gone: true };
  }
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  let aheadCount = 0;
  if (ahead)
  {
    aheadCount = Number(ahead[1]);
  }
  let behindCount = 0;
  if (behind)
  {
    behindCount = Number(behind[1]);
  }
  return { ahead: aheadCount, behind: behindCount, gone: false };
}

/**
 * Parse git for-each-ref output. Splits on newlines (safe here, not elsewhere).
 * remotes parameter: remote branches can contain slashes.
 */
export function parseRefList(text: string, remotes: readonly string[] = []): RefEntry[]
{
  const entries: RefEntry[] = [];

  for (const line of text.split('\n'))
  {
    if (!line)
    {
      continue;
    }
    const fields = line.split('\0');
    const at = (i: number): string => fields[i] ?? '';

    const fullName = at(0);
    const kind = refKind(fullName);
    if (!kind)
    {
      continue;
    }

    const name = fullName.slice(REF_PREFIXES[kind].length);
    // Remote's HEAD is a symref to the default branch, not a branch itself.
    if (kind === REF_KIND_REMOTE && name.endsWith('/HEAD'))
    {
      continue;
    }

    const peeled = at(3);
    const track = parseUpstreamTrack(at(7));

    let dateField: string;
    if (peeled)
    {
      dateField = at(5);
    }
    else
    {
      dateField = at(4);
    }

    let remote: string | null;
    if (kind === REF_KIND_REMOTE)
    {
      remote = remoteOf(name, remotes);
    }
    else
    {
      remote = null;
    }

    entries.push({
      fullName,
      name,
      kind,
      // For annotated tags, use the peeled commit SHA (what tag points at), not tag's own SHA.
      sha: peeled || at(2),
      date: Number(dateField) || 0,
      isCurrent: at(8) === CURRENT_BRANCH_MARKER,
      upstream: at(6) || null,
      ahead: track.ahead,
      behind: track.behind,
      upstreamGone: track.gone,
      remote,
      isAnnotated: at(1) === OBJECT_KIND_TAG
    });
  }

  return entries;
}
