/**
 * One local branch judged for cleanup: offered for deletion, kept back with the reason,
 * or skipped as the comparison itself. Everything it is judged against is worked out
 * once per scan by the caller and handed in as a `ScanContext`.
 */

import {
  toBranchName,
  type BranchName,
  type FullRefName,
  type KeptBackBranch,
  type RefEntry,
  type StaleBranch
} from '@shared/types.js';
import { isSquashedInto } from './squashMerge.js';

const HEAD = 'HEAD';
const REASON_CONTAINED = 'contained';
const REASON_SQUASHED = 'squashed';

/** One branch's answer: offered, kept back with why, or neither (the comparison itself). */
export type Verdict =
  | { stale: StaleBranch; kept?: never }
  | { kept: KeptBackBranch; stale?: never }
  | null;

/** What every branch is judged against, worked out once per scan. */
export interface ScanContext {
  /** The comparison as the user named it: what the sentences in a verdict say. */
  comparison: string;
  /**
   * The same ref by its full name, which is what git is handed: a short name resolves as
   * a tag before a branch, so a tag `main` would otherwise answer for branch `main`.
   */
  comparisonRef: FullRefName;
  /** A short ref name, an upstream, as its full name: the short one when it is not a ref. */
  fullRef: (short: string) => FullRefName;
  /** The local branch `comparison` is a remote copy of, if it is one. */
  localCopy: BranchName | null;
  /** Branches checked out in some worktree, each with the sentence saying where. */
  checkedOut: ReadonlyMap<BranchName, string>;
  /** Branches whose tips are ancestors of `comparison`. */
  contained: ReadonlySet<BranchName>;
  /** The branches merged into a ref: shared across the scan, since most refs repeat. */
  mergedInto: (commit: string) => Promise<ReadonlySet<BranchName>>;
  /** Fires when the scan is abandoned: a squash test stops between its git calls. */
  signal?: AbortSignal;
}

/**
 * What `git branch -d` judges a branch against: its upstream while that still exists,
 * HEAD otherwise. Never the comparison the dialog chose, which is why a branch can be
 * merged into it and still need `-D`.
 */
function deleteReference(ref: RefEntry, context: ScanContext): string
{
  if (ref.upstream && !ref.upstreamGone)
  {
    return context.fullRef(ref.upstream);
  }
  return HEAD;
}

/** Why a branch cannot be deleted however merged it is, or null when nothing stops it. */
function heldBy(ref: RefEntry, name: BranchName, context: ScanContext): string | null
{
  if (name === context.localCopy)
  {
    return `the local copy of ${context.comparison}`;
  }
  if (ref.isCurrent)
  {
    return 'the current branch';
  }
  return context.checkedOut.get(name) ?? null;
}

export async function judgeBranch(
  repoPath: string,
  ref: RefEntry,
  context: ScanContext
): Promise<Verdict>
{
  const { comparison } = context;
  const name = toBranchName(ref.name);
  if (ref.fullName === context.comparisonRef)
  {
    return null;
  }
  const held = heldBy(ref, name, context);
  if (held)
  {
    return { kept: { name, why: held } };
  }

  const entry = { name, sha: ref.sha, date: ref.date, upstreamGone: ref.upstreamGone };
  if (context.contained.has(name))
  {
    const accepted = (await context.mergedInto(deleteReference(ref, context))).has(name);
    return { stale: { ...entry, reason: REASON_CONTAINED, needsForce: !accepted } };
  }
  if (await isSquashedInto(repoPath, name, context.comparisonRef, context.signal))
  {
    return { stale: { ...entry, reason: REASON_SQUASHED, needsForce: true } };
  }
  return { kept: { name, why: `has work not on ${comparison}` } };
}
