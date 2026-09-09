/**
 * Checkable branches for a commit: excludes current and origin/HEAD (not a real branch).
 * Pure, testable logic (not in menu code).
 */

import { REF_KIND_BRANCH, REF_KIND_REMOTE, type CommitRef } from '@shared/types.js';

const HEAD_SUFFIX = '/HEAD';

export interface CheckoutRow {
  /** The ref as git names it: `main`, `origin/feature`. */
  ref: string;
  /** Remote branches check out differently: the dialog asks about tracking first. */
  remote: boolean;
}

export function checkoutRowsFor(refs: readonly CommitRef[]): CheckoutRow[]
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
