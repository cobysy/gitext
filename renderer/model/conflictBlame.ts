/**
 * Attribute conflict block to commit on each side. Text in block found in full blob
 * and blamed there. Offset unreliable; text search is exact.
 */

import type { BlameCommitInfo, BlameFile } from '@shared/types.js';

/**
 * Find needle in haystack from start, 0-based inclusive end.
 * Null if not found: block resolved or hand-edited.
 */
export function findLineRange(
  haystack: readonly string[],
  needle: readonly string[],
  from: number
): { start: number; end: number } | null
{
  if (needle.length === 0 || from < 0)
  {
    return null;
  }
  for (let i = from; i <= haystack.length - needle.length; i += 1)
  {
    let matches = true;
    for (let j = 0; j < needle.length; j += 1)
    {
      if (haystack[i + j] !== needle[j])
      {
        matches = false;
        break;
      }
    }
    if (matches)
    {
      return { start: i, end: i + needle.length - 1 };
    }
  }
  return null;
}

/**
 * Most recent commit for lines. Ties to latest authorTime: newest edit is
 * worth asking about.
 */
export function commitForLines(
  blame: BlameFile,
  startLine: number,
  endLine: number
): BlameCommitInfo | null
{
  let latest: BlameCommitInfo | null = null;
  for (const line of blame.lines)
  {
    if (line.finalLine < startLine || line.finalLine > endLine)
    {
      continue;
    }
    const commit = blame.commits[line.sha];
    if (!commit)
    {
      continue;
    }
    if (!latest || commit.authorTime > latest.authorTime)
    {
      latest = commit;
    }
  }
  return latest;
}

/**
 * The commit most recently responsible for the file as a whole, on one side: every
 * blamed line's commit, latest `authorTime` wins. Null for a side that was not blamed.
 */
export function latestCommit(blame: BlameFile | null): BlameCommitInfo | null
{
  if (!blame)
  {
    return null;
  }
  return commitForLines(blame, 1, Infinity);
}
