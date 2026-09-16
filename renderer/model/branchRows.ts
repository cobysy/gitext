/**
 * The branches a right-clicked commit can act on: the rows of the revision grid's
 * *Checkout Branch* and *Delete Branch* submenus. Excludes the current branch, which
 * neither checking out nor deleting can do anything with, and origin/HEAD, which is a
 * pointer rather than a branch. Pure, testable logic (not in menu code).
 */

import { REF_KIND_BRANCH, REF_KIND_REMOTE, type CommitRef } from '@shared/types.js';

const HEAD_SUFFIX = '/HEAD';

export interface BranchRow {
  /** The ref as git names it: `main`, `origin/feature`. */
  ref: string;
  /** Remote branches check out and delete differently: through tracking, and through a push. */
  remote: boolean;
}

export function branchRowsFor(refs: readonly CommitRef[]): BranchRow[]
{
  const usable = refs.filter(
    (ref) =>
      !ref.isCurrent &&
      !ref.name.endsWith(HEAD_SUFFIX) &&
      (ref.kind === REF_KIND_BRANCH || ref.kind === REF_KIND_REMOTE)
  );

  // Locals first: they are what you are almost always after, and a remote branch here is
  // a checkout that has to decide about tracking before it can happen.
  return [
    ...usable.filter((ref) => ref.kind === REF_KIND_BRANCH),
    ...usable.filter((ref) => ref.kind === REF_KIND_REMOTE)
  ].map((ref) => ({ ref: ref.name, remote: ref.kind === REF_KIND_REMOTE }));
}
