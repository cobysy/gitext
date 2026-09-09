import type { DiffFileEntry, LineCounts } from '@shared/diff.js';
import { isSubmoduleMode } from '@shared/mode.js';
import { FILE_STATUS_COPIED, FILE_STATUS_RENAMED, type FileStatusCode } from '@shared/types.js';
import { splitNul } from './common.js';

// Diff status letters from `git diff --raw`
const DIFF_ADDED = 'A';
const DIFF_MODIFIED = 'M';
const DIFF_DELETED = 'D';
const DIFF_RENAMED = 'R';
const DIFF_COPIED = 'C';
const DIFF_TYPECHANGE = 'T';
const DIFF_CONFLICTED = 'U';

// Field markers
const RAW_META_PREFIX = ':';
const NUMSTAT_SEPARATOR = '\t';

/** The mode git writes for a side that does not exist (add, delete). */
const ABSENT_MODE = '000000';

// Rename detection in numstat (empty path indicates rename)
const NUMSTAT_BINARY_MARKER = '-';

/** Map a status letter to a status code. */
function diffStatusToCode(letter: string): FileStatusCode
{
  switch (letter)
  {
    case DIFF_ADDED:
      return 'added';
    case DIFF_MODIFIED:
      return 'modified';
    case DIFF_DELETED:
      return 'deleted';
    case DIFF_RENAMED:
      return FILE_STATUS_RENAMED;
    case DIFF_COPIED:
      return FILE_STATUS_COPIED;
    case DIFF_TYPECHANGE:
      return 'typechange';
    case DIFF_CONFLICTED:
      return 'conflicted';
    default:
      return 'unknown';
  }
}

/**
 * Parse one `--raw` metadata field.
 *
 * Format: `:<srcmode> <dstmode> <srcsha> <dstsha> <status>[<score>]`
 * Example: `:100644 100644 abc1234 def5678 M` or `:000000 100644 abc1234 def5678 A`
 *
 * For deletion, newer end is 000000, so use source mode. For addition, destination is 000000.
 * Combined diffs (merges) add extra `:` prefix, mode, sha per parent; read from ends not position.
 */
function parseRawMeta(field: string): { mode: string; status: FileStatusCode; score: number }
{
  const parts = field.replace(/^:+/, '').split(' ');
  const statusField = parts.pop() ?? '';
  // Modes first, then shas, in equal counts: the last mode is the newer end.
  const modes = parts.slice(0, parts.length / 2);
  const dstMode = modes[modes.length - 1] ?? '';
  const srcMode = modes[0] ?? '';

  let mode: string;
  if (dstMode === ABSENT_MODE)
  {
    mode = srcMode;
  }
  else
  {
    mode = dstMode;
  }
  return {
    mode,
    status: diffStatusToCode(statusField[0] ?? ''),
    score: Number(statusField.slice(1)) || 0
  };
}

/**
 * Parse `git diff --raw --numstat -z` output.
 *
 * Two sections, NUL-separated fields:
 * 1. Raw metadata (fields starting with `:`)
 * 2. Numstat (line counts per path)
 *
 * Raw: `:` prefix + metadata + path; for rename/copy: + orig-path.
 * Numstat: `added TAB deleted TAB path`; for rename: path is empty, orig/new follow.
 *
 * Example (simplified):
 * ```
 * :100644 100644 abc123 def456 M\0src/file.ts\0
 * 10\t5\tsrc/file.ts\0
 * :000000 100644 abc123 ghi789 A\0new.ts\0
 * -\t-\tnew.ts\0
 * :100644 100644 abc123 def456 R100\0old.ts\0new.ts\0
 * 0\t0\tOLD\0new.ts\0
 * ```
 *
 * `-` in numstat added/deleted indicates binary.
 */
export function parseDiffRaw(text: string): DiffFileEntry[]
{
  const fields = splitNul(text);
  const entries: DiffFileEntry[] = [];
  /** Paths git reported no line counts for, i.e. the ones it saw as binary. */
  const binary = new Set<string>();
  /** Lines added and removed, by path: the numstat section, which follows the raw one. */
  const counts = new Map<string, LineCounts>();

  for (let i = 0; i < fields.length; i++)
  {
    const field = fields[i];
    if (!field)
    {
      continue;
    }

    if (field.startsWith(RAW_META_PREFIX))
    {
      const { mode, status, score } = parseRawMeta(field);
      const moved = status === FILE_STATUS_RENAMED || status === FILE_STATUS_COPIED;

      const first = fields[++i];
      if (first === undefined)
      {
        break;
      }

      let kind: 'blob' | 'submodule';
      if (isSubmoduleMode(mode))
      {
        kind = 'submodule';
      }
      else
      {
        kind = 'blob';
      }
      if (moved)
      {
        const second = fields[++i];
        if (second === undefined)
        {
          break;
        }
        entries.push({ path: second, origPath: first, status, score, kind, mode, binary: false });
      }
      else
      {
        entries.push({ path: first, status, score, kind, mode, binary: false });
      }
      continue;
    }

    // Numstat: added TAB deleted TAB path. Empty path means rename follows.
    const [added = '', deleted = '', rest] = field.split(NUMSTAT_SEPARATOR);
    if (rest === undefined)
    {
      continue;
    }

    let path = rest;
    if (path === '')
    {
      i++;
      const second = fields[++i];
      if (second === undefined)
      {
        break;
      }
      path = second;
    }
    // Binary file marker in numstat.
    if (added === NUMSTAT_BINARY_MARKER)
    {
      binary.add(path);
    }
    else
    {
      counts.set(path, { added: Number(added) || 0, deleted: Number(deleted) || 0 });
    }
  }

  for (const entry of entries)
  {
    if (binary.has(entry.path))
    {
      entry.binary = true;
    }
    const lines = counts.get(entry.path);
    if (lines)
    {
      entry.lines = lines;
    }
  }

  return entries;
}
