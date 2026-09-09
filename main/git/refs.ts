/**
 * Left panel's three ref sections: one `for-each-ref` call covers all (efficiency on watcher tick).
 */

import type { RefEntry } from '@shared/types.js';
import { REF_FORMAT, parseRefList } from './parse.js';
import { getRemoteNames } from './remote.js';
import { GIT_KIND_READ, runGit, tryGit } from './runner.js';

const CMD_FOR_EACH_REF = 'for-each-ref';
const FLAG_MERGED = '--merged';
const REFS_HEADS = 'refs/heads';
const REFS_REMOTES = 'refs/remotes';
const REFS_TAGS = 'refs/tags';

export function buildRefListArgs(): string[]
{
  return [
    CMD_FOR_EACH_REF,
    `--format=${REF_FORMAT}`,
    REFS_HEADS,
    REFS_REMOTES,
    REFS_TAGS
  ];
}

/** Refs merged into commit: separate call (--merged selects but doesn't annotate). Fast enough to run per selection. */
export function buildMergedRefsArgs(commit: string): string[]
{
  return [
    CMD_FOR_EACH_REF,
    FLAG_MERGED,
    commit,
    '--format=%(refname)',
    REFS_HEADS,
    REFS_REMOTES
  ];
}

export async function listMergedRefs(repoPath: string, commit: string): Promise<string[]>
{
  // An unborn or unknown commit is not an error worth surfacing: nothing is merged
  // into it, which is exactly what an empty list says.
  const out = await tryGit(repoPath, buildMergedRefsArgs(commit));
  if (out)
  {
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  else
  {
    return [];
  }
}

export async function listRefs(repoPath: string): Promise<RefEntry[]>
{
  // Remote names are needed to split `origin/feature/x` at the right slash, and are
  // cheap enough to read alongside rather than make the caller supply.
  const [remotes, out] = await Promise.all([
    getRemoteNames(repoPath),
    runGit(repoPath, buildRefListArgs(), { kind: GIT_KIND_READ })
  ]);
  return parseRefList(out, remotes);
}
