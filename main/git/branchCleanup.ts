/**
 * Branches to clean up. Squash merges leave no trace (proved by: contained in merge base, or squashed patch match).
 */

import { REF_KIND_BRANCH, type BranchCleanupReport, type StaleBranch } from '@shared/types.js';
import { listMergedRefs, listRefs } from './refs.js';
import { GIT_KIND_READ, runGit, tryGit } from './runner.js';
import { listWorktrees } from './worktree.js';

const CMD_MERGE_BASE = 'merge-base';
const CMD_REV_PARSE = 'rev-parse';
const CMD_COMMIT_TREE = 'commit-tree';
const CMD_CHERRY = 'cherry';
const FLAG_PARENT = '-p';
const FLAG_MESSAGE = '-m';
const CLEANUP_PROBE_MESSAGE = 'cleanup probe';
const CHERRY_NEW_MARKER = '+';

const REFS_HEADS_PREFIX = 'refs/heads/';

const REASON_CONTAINED = 'contained';
const REASON_SQUASHED = 'squashed';

/**
 * Whether `branch`'s net change is already present on `comparison`.
 *
 * `git cherry` marks a commit `-` when an equivalent patch exists upstream and `+` when
 * it does not, so "no `+` lines" means nothing here is new. The dangling commit is what
 * is handed to it, not the branch, so that N branch commits are judged as the one patch
 * a squash merge would have produced.
 */
async function isSquashedInto(
  repoPath: string,
  branch: string,
  comparison: string
): Promise<boolean>
{
  const base = (await tryGit(repoPath, [CMD_MERGE_BASE, comparison, branch]))?.trim();
  // No common ancestor at all: an unrelated history, which is never "already merged".
  if (!base)
  {
    return false;
  }

  const tree = (await tryGit(repoPath, [CMD_REV_PARSE, `${branch}^{tree}`]))?.trim();
  if (!tree)
  {
    return false;
  }

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

  const out = await runGit(repoPath, [CMD_CHERRY, comparison, dangling], {
    kind: GIT_KIND_READ
  });
  return !out.split('\n').some((line) => line.startsWith(CHERRY_NEW_MARKER));
}

/**
 * Local branches safe to delete, and the ones deliberately left out.
 *
 * `comparison` is the branch work lands on: usually `main`. It is a parameter rather
 * than a guess because "the branch everything merges into" is a fact about a project,
 * not about a repository, and getting it wrong here would offer to delete live work.
 */
export async function listStaleBranches(
  repoPath: string,
  comparison: string
): Promise<BranchCleanupReport>
{
  const [refs, mergedFullNames, worktrees] = await Promise.all([
    listRefs(repoPath),
    listMergedRefs(repoPath, comparison),
    listWorktrees(repoPath)
  ]);

  const locals = refs.filter((ref) => ref.kind === REF_KIND_BRANCH);
  const contained = new Set(
    mergedFullNames
      .filter((name) => name.startsWith(REFS_HEADS_PREFIX))
      .map((name) => name.slice(REFS_HEADS_PREFIX.length))
  );

  // A branch checked out anywhere, this window's HEAD or another worktree's, cannot be
  // deleted, and git would refuse. Saying so up front beats letting the delete fail.
  const checkedOut = new Map<string, string>();
  for (const tree of worktrees)
  {
    if (tree.branch)
    {
      let reason: string;
      if (tree.isMain)
      {
        reason = 'checked out';
      }
      else
      {
        reason = `checked out in ${tree.path}`;
      }
      checkedOut.set(tree.branch, reason);
    }
  }

  const stale: StaleBranch[] = [];
  const keptBack: { name: string; why: string }[] = [];

  for (const ref of locals)
  {
    if (ref.name === comparison)
    {
      continue;
    }

    let checkout;
    if (ref.isCurrent)
    {
      checkout = 'the current branch';
    }
    else
    {
      checkout = checkedOut.get(ref.name);
    }
    if (checkout)
    {
      keptBack.push({ name: ref.name, why: checkout });
      continue;
    }

    const entry = { name: ref.name, sha: ref.sha, date: ref.date, upstreamGone: ref.upstreamGone };

    if (contained.has(ref.name))
    {
      stale.push({ ...entry, reason: REASON_CONTAINED });
    }
    else if (await isSquashedInto(repoPath, ref.name, comparison))
    {
      stale.push({ ...entry, reason: REASON_SQUASHED });
    }
    else
    {
      keptBack.push({ name: ref.name, why: `has work not on ${comparison}` });
    }
  }

  return { stale, examined: locals.length, keptBack };
}
