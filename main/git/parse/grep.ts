/**
 * Parse `git grep -z --line-number`: path\0line_number\0text\n.
 * Hybrid format: fields NUL-terminated, text ends with newline (paths contain newlines).
 * Parse manually: splitting breaks paths/line numbers.
 */

import type { GrepHit } from '@shared/grep.js';

export interface ParsedGrep {
  hits: GrepHit[];
  /** True when `limit` stopped the read with output still unconsumed. */
  truncated: boolean;
}

export interface ParseGrepOptions {
  /** git prefix when search named revision (e.g. HEAD:), empty for working tree/index. */
  pathPrefix?: string;
  /** Stop after this many hits and report truncation. */
  limit: number;
}

export function parseGrep(out: string, options: ParseGrepOptions): ParsedGrep
{
  const prefix = options.pathPrefix ?? '';
  const hits: GrepHit[] = [];
  let at = 0;

  while (at < out.length)
  {
    const pathEnd = out.indexOf('\0', at);
    if (pathEnd === -1)
    {
      break;
    }
    const lineEnd = out.indexOf('\0', pathEnd + 1);
    if (lineEnd === -1)
    {
      break;
    }
    // Last record may lack trailing newline if git's output was cut short.
    const textEnd = out.indexOf('\n', lineEnd + 1);
    let end;
    if (textEnd === -1)
    {
      end = out.length;
    }
    else
    {
      end = textEnd;
    }

    const rawPath = out.slice(at, pathEnd);
    const line = Number(out.slice(pathEnd + 1, lineEnd));

    // Non-numeric line: skip record rather than guessing, prevents one oddity swallowing result.
    if (Number.isFinite(line) && line > 0)
    {
      if (hits.length >= options.limit)
      {
        return { hits, truncated: true };
      }
      let path: string;
      if (prefix && rawPath.startsWith(prefix))
      {
        path = rawPath.slice(prefix.length);
      }
      else
      {
        path = rawPath;
      }
      hits.push({
        path,
        line,
        text: out.slice(lineEnd + 1, end)
      });
    }

    at = end + 1;
  }

  return { hits, truncated: false };
}
