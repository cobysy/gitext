/**
 * Per-commit details (separate from log query): --notes is expensive per commit.
 */

import type { CommitDetails, CommitSummary } from '@shared/types.js';
import { splitNul } from './parse.js';
import { tryGit } from './runner.js';

const CMD_LOG = 'log';
const FLAG_LIMIT_ONE = '-1';
const FLAG_NOTES = '--notes';

export async function getCommitDetails(repoPath: string, sha: string): Promise<CommitDetails>
{
  const out = await tryGit(repoPath, [
    CMD_LOG,
    FLAG_LIMIT_ONE,
    FLAG_NOTES,
    '--format=%N',
    sha
  ]);
  if (!out)
  {
    return { sha, note: '' };
  }

  return { sha, note: out.trim() };
}

/** Resolve revision to commit (log -1, not rev-parse: rejects tree/blob). tryGit for null on unresolvable. */
export async function describeRevision(
  repoPath: string,
  rev: string
): Promise<CommitSummary | null>
{
  if (!rev.trim())
  {
    return null;
  }

  const out = await tryGit(repoPath, [
    CMD_LOG,
    FLAG_LIMIT_ONE,
    '--format=%H%x00%s%x00%an%x00%at',
    `${rev}^{commit}`,
    // Nothing after this is a path, which is what stops a branch and a file of the same
    // name from being ambiguous: git errors on the ambiguity rather than guessing.
    '--'
  ]);
  if (!out)
  {
    return null;
  }

  const [sha = '', subject = '', authorName = '', authorDate = ''] = splitNul(out);
  if (!sha)
  {
    return null;
  }

  return {
    sha: sha.trim(),
    subject,
    authorName,
    authorDate: Number(authorDate) || 0
  };
}
