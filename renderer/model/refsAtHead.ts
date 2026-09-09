/**
 * Which refs HEAD is on: re-derived from current branch, not from `%D` at log time.
 * Grid reuses rows on checkout (no reload unless scope is `current`); chips follow separately.
 */

import { REF_KIND_BRANCH, REF_KIND_HEAD, type CommitRef } from '@shared/types.js';

/**
 * `refs` with `isCurrent` re-decided against `branch`, which is null on a detached HEAD.
 *
 * Only the branch chips can move: a tag or a remote-tracking branch is never what HEAD is
 * on, and `%D` never marks one.
 */
export function refsAtHead(refs: readonly CommitRef[], branch: string | null): CommitRef[]
{
  const detached = !branch;

  /**
   * A bare `HEAD` chip is git's decoration for a detached HEAD, so it describes a state the
   * repository has left the moment a branch is checked out. The reverse: marking a HEAD
   * that has since detached, on a row whose decorations predate it: would need a chip the
   * row does not carry, and is what the graph's HEAD ring is for.
   */
  const stillStands = (ref: CommitRef): boolean => ref.kind !== REF_KIND_HEAD || detached;

  const isAtHead = (ref: CommitRef): boolean =>
  {
    switch (ref.kind)
    {
      case REF_KIND_BRANCH:
        return ref.name === branch;
      case REF_KIND_HEAD:
        return detached;
      default:
        return false;
    }
  };

  return refs.filter(stillStands).map((ref) => ({ ...ref, isCurrent: isAtHead(ref) }));
}
