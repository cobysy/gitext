/**
 * Shared parsing: NUL-splitting and git version parsing. Version predates porcelain
 * formats so has its own pattern.
 */

import type { GitVersion } from '@shared/types.js';

/** Split NUL-delimited output, discarding trailing empty element. */
export function splitNul(text: string): string[]
{
  const parts = text.split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '')
  {
    parts.pop();
  }
  return parts;
}

export function parseGitVersion(raw: string): GitVersion | null
{
  // Parse "git version X.Y[.Z] ..." format.
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
  if (!match)
  {
    return null;
  }
  return {
    raw: raw.trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0)
  };
}
