/**
 * Whether a branch was squash-merged: its content is on the comparison branch as one
 * commit with no ancestry link, which git's own merge test cannot see.
 */

import type { BranchName, FullRefName } from '@shared/types.js';
import { GIT_KIND_READ, runGit, tryGit } from './runner.js';

const CMD_MERGE_BASE = 'merge-base';
const CMD_REV_PARSE = 'rev-parse';
const CMD_COMMIT_TREE = 'commit-tree';
const CMD_CHERRY = 'cherry';
const FLAG_PARENT = '-p';
const FLAG_MESSAGE = '-m';
const CLEANUP_PROBE_MESSAGE = 'cleanup probe';
const CHERRY_NEW_MARKER = '+';
const REFS_HEADS_PREFIX = 'refs/heads/';

/**
 * Whether `branch`'s net change is already present on `comparison`.
 *
 * `git cherry` marks a commit `-` when an equivalent patch exists upstream and `+` when
 * it does not, so "no `+` lines" means nothing here is new. The dangling commit is what
 * is handed to it, not the branch, so that N branch commits are judged as the one patch
 * a squash merge would have produced.
 *
 * `signal` is checked before each of the four calls, so an abandoned scan stops after
 * the call it is in rather than running the chain out.
 */
export async function isSquashedInto(
  repoPath: string,
  branch: BranchName,
  comparison: FullRefName,
  signal?: AbortSignal
): Promise<boolean>
{
  signal?.throwIfAborted();
  // The full ref, never the short name: git resolves a bare name as a tag before a
  // branch, so a tag `release` on landed work would prove branch `release` merged.
  const ref = `${REFS_HEADS_PREFIX}${branch}`;
  const base = (await tryGit(repoPath, [CMD_MERGE_BASE, comparison, ref]))?.trim();
  // No common ancestor at all: an unrelated history, which is never "already merged".
  if (!base)
  {
    return false;
  }

  signal?.throwIfAborted();
  const tree = (await tryGit(repoPath, [CMD_REV_PARSE, `${ref}^{tree}`]))?.trim();
  if (!tree)
  {
    return false;
  }

  signal?.throwIfAborted();
  const dangling = (
    await runGit(repoPath, [
      CMD_COMMIT_TREE,
      tree,
      FLAG_PARENT,
      base,
      FLAG_MESSAGE,
      CLEANUP_PROBE_MESSAGE
    ])
  ).trim();
  if (!dangling)
  {
    return false;
  }

  signal?.throwIfAborted();
  const out = await runGit(repoPath, [CMD_CHERRY, comparison, dangling], {
    kind: GIT_KIND_READ
  });
  return !out.split('\n').some((line) => line.startsWith(CHERRY_NEW_MARKER));
}
