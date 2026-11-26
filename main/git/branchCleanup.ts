/**
 * Branches to clean up: every local branch judged against the comparison, eight at a
 * time. What makes one branch stale is `./branchVerdict.ts`; this is the scan around it,
 * the facts worked out once for all of them, and how far it has got.
 */

import {
  REF_KIND_BRANCH,
  REF_KIND_REMOTE,
  toBranchName,
  toFullRefName,
  type BranchCleanupProgress,
  type BranchCleanupReport,
  type BranchName,
  type FullRefName,
  type KeptBackBranch,
  type RefEntry,
  type StaleBranch,
  type WorktreeEntry
} from '@shared/types.js';
import { mapLimited } from '@main/mapLimited.js';
import { judgeBranch, type Verdict } from './branchVerdict.js';
import { listMergedRefs, listRefs } from './refs.js';
import { listWorktrees } from './worktree.js';

const REFS_HEADS_PREFIX = 'refs/heads/';

/**
 * Branches judged at once. A squash check is four subprocesses in a row, so one branch
 * at a time spends the scan waiting on spawns; eight keeps that wait covered without a
 * list of hundreds forking hundreds of processes.
 */
const PARALLEL_CHECKS = 8;

/** Local branch names whose tips are ancestors of `commit`. */
async function localsMergedInto(repoPath: string, commit: string): Promise<Set<BranchName>>
{
  const fullNames = await listMergedRefs(repoPath, commit);
  return new Set(
    fullNames
      .filter((name) => name.startsWith(REFS_HEADS_PREFIX))
      .map((name) => toBranchName(name.slice(REFS_HEADS_PREFIX.length)))
  );
}

/**
 * A short branch or remote-tracking name as its full ref, the local branch first, as git
 * itself would choose between them. Never a tag: a tag sharing a branch's name is what
 * this exists to step around. A name matching neither is handed back as it came.
 */
function fullRefIn(refs: readonly RefEntry[]): (short: string) => FullRefName
{
  return (short) =>
  {
    const branch = refs.find((ref) => ref.kind === REF_KIND_BRANCH && ref.name === short);
    const remote = refs.find((ref) => ref.kind === REF_KIND_REMOTE && ref.name === short);
    return toFullRefName((branch ?? remote)?.fullName ?? short);
  };
}

/**
 * The local branch a remote-tracking comparison is a copy of: `main` for `origin/main`.
 * It is contained in its own remote copy whenever it is behind, which is not the same
 * thing as being done with.
 */
function localCopyOf(refs: readonly RefEntry[], comparisonRef: FullRefName): BranchName | null
{
  // By the ref the scan compares against, not the short name: a local branch that is
  // itself called `origin/main` is what `origin/main` resolves to, and has no local copy.
  const remote = refs.find((ref) => ref.kind === REF_KIND_REMOTE && ref.fullName === comparisonRef);
  if (!remote?.remote)
  {
    return null;
  }
  return toBranchName(remote.name.slice(remote.remote.length + 1));
}

/** The local branches merged into a ref, each ref asked of git once: most branches share HEAD. */
function mergedSets(repoPath: string): (commit: string) => Promise<Set<BranchName>>
{
  const cache = new Map<string, Promise<Set<BranchName>>>();
  return (commit) =>
  {
    let found = cache.get(commit);
    if (!found)
    {
      found = localsMergedInto(repoPath, commit);
      cache.set(commit, found);
    }
    return found;
  };
}

/** How far a scan has got: the event's payload, before the window's request id is added. */
export type CleanupProgress = Omit<BranchCleanupProgress, 'requestId'>;

/**
 * Branches checked out anywhere, this window's HEAD or another worktree's: git refuses
 * to delete one, and saying so up front beats letting the delete fail.
 */
function checkedOutIn(worktrees: readonly WorktreeEntry[]): Map<BranchName, string>
{
  const checkedOut = new Map<BranchName, string>();
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
      checkedOut.set(toBranchName(tree.branch), reason);
    }
  }
  return checkedOut;
}

export interface CleanupScanOptions {
  /** Sent each time a branch has been judged. */
  onProgress?: (progress: CleanupProgress) => void;
  /** Stops the scan, between git calls: it then rejects with the signal's reason. */
  signal?: AbortSignal;
}

/**
 * Local branches safe to delete, and the ones deliberately left out.
 *
 * `comparison` is the branch work lands on: `main`, or `origin/main` when the merges
 * happen on the server. It is a parameter rather than a guess because "the branch
 * everything merges into" is a fact about a project, not about a repository, and getting
 * it wrong here would offer to delete live work.
 */
export async function listStaleBranches(
  repoPath: string,
  comparison: string,
  { onProgress, signal }: CleanupScanOptions = {}
): Promise<BranchCleanupReport>
{
  const [refs, worktrees] = await Promise.all([listRefs(repoPath), listWorktrees(repoPath)]);
  const fullRef = fullRefIn(refs);
  const comparisonRef = fullRef(comparison);
  const mergedInto = mergedSets(repoPath);
  const contained = await mergedInto(comparisonRef);
  const locals = refs.filter((ref) => ref.kind === REF_KIND_BRANCH);
  const localCopy = localCopyOf(refs, comparisonRef);
  const checkedOut = checkedOutIn(worktrees);

  const context = {
    comparison,
    comparisonRef,
    fullRef,
    localCopy,
    checkedOut,
    contained,
    mergedInto,
    signal
  };
  const judge = (ref: RefEntry): Promise<Verdict> => judgeBranch(repoPath, ref, context);
  const verdicts = await mapLimited(locals, PARALLEL_CHECKS, judge, {
    signal,
    onSettled: (checked) => onProgress?.({ checked, total: locals.length })
  });

  const stale: StaleBranch[] = [];
  const keptBack: KeptBackBranch[] = [];
  for (const verdict of verdicts)
  {
    if (verdict?.stale)
    {
      stale.push(verdict.stale);
    }
    if (verdict?.kept)
    {
      keptBack.push(verdict.kept);
    }
  }

  return { stale, examined: locals.length, keptBack };
}
