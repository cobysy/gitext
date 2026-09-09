/**
 * What local branch a remote branch becomes. Worked out every time the picker moves,
 * deciding three things at once: the name the *Reset local branch* radio offers,
 * whether it says "reset" or "create", and the custom-name field's prefill. Pure and
 * here rather than in the dialog, since it's three string rules testable as a table.
 */

import { REF_KIND_REMOTE, REF_KIND_TAG } from '@shared/types.js';

/** The remote a branch belongs to, and the branch name inside it. */
export interface RemoteBranchParts {
  remote: string;
  branch: string;
}

/**
 * Split `origin/feature/x` into `origin` and `feature/x`, given the remotes that exist.
 * The remote names are needed, not "everything before the first slash": `feature/x` on
 * `origin` and `x` on `origin/feature` spell the same string. Longest match wins for the same reason. Null when no remote claims it.
 */
export function splitRemoteBranch(
  fullName: string,
  remotes: readonly string[]
): RemoteBranchParts | null
{
  const matches = remotes
    .filter((remote) => fullName.startsWith(`${remote}/`))
    .sort((a, b) => b.length - a.length);
  const remote = matches[0];
  if (remote === undefined)
  {
    return null;
  }
  return { remote, branch: fullName.slice(remote.length + 1) };
}

/**
 * The local branch this remote branch corresponds to. A lookup, not a call to git: the
 * tracking config's answer is already in the ref list. A branch whose upstream *is* this
 * remote branch wins over one that merely shares its name: the name is a convention, the upstream is a fact.
 */
export function localTrackingBranchName(
  remoteBranch: string,
  remotes: readonly string[],
  locals: readonly { name: string; upstream: string | null }[]
): string
{
  const tracking = locals.find((local) => local.upstream === remoteBranch);
  if (tracking)
  {
    return tracking.name;
  }
  return splitRemoteBranch(remoteBranch, remotes)?.branch ?? remoteBranch;
}

/** The shape `suggestedBranchNameAt` needs of a ref: enough to match it and name it. */
export interface RefAtRevision {
  name: string;
  fullName: string;
  sha: string;
  kind: 'branch' | 'remote' | 'tag';
}

/**
 * What to prefill the *new branch's* name with, given where it starts. Filled from a
 * ref already on the target commit, preferring anything that isn't a tag, and takes its
 * local name: standing on `origin/feature` suggests `feature`. The revision may be a
 * SHA, a SHA prefix, or a ref name, so all three are matched. Empty when nothing points there.
 */
export function suggestedBranchNameAt(rev: string, refs: readonly RefAtRevision[]): string
{
  if (!rev)
  {
    return '';
  }

  const here = refs.filter(
    (ref) =>
      ref.name === rev ||
      ref.fullName === rev ||
      // A prefix, not equality: the grid hands over a full SHA and the panel a short one, and `startsWith` covers both without the caller saying which.
      (rev.length >= 4 && ref.sha.startsWith(rev))
  );

  const chosen = here.find((ref) => ref.kind !== REF_KIND_TAG) ?? here[0];
  if (!chosen)
  {
    return '';
  }

  // A remote branch suggests the branch, not `origin/` and the branch.
  if (chosen.kind === REF_KIND_REMOTE)
  {
    return chosen.name.slice(chosen.name.indexOf('/') + 1);
  }
  else
  {
    return chosen.name;
  }
}

/**
 * The name the custom-name field opens with: `<remote>_<branch>`, then `_2`, `_3`. An
 * underscore, not a slash: this field creates a branch *beside* the one the tracking
 * name would take, and `origin/feature` as a local branch name reads as a remote one ever after.
 */
export function suggestedLocalBranchName(
  remoteBranch: string,
  remotes: readonly string[],
  existing: readonly string[]
): string
{
  const parts = splitRemoteBranch(remoteBranch, remotes);
  let base;
  if (parts)
  {
    base = `${parts.remote}_${parts.branch}`;
  }
  else
  {
    base = remoteBranch;
  }

  const taken = new Set(existing);
  if (!taken.has(base))
  {
    return base;
  }
  for (let i = 2; ; i++)
  {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate))
    {
      return candidate;
    }
  }
}

/**
 * The name the *Put them on a branch* field opens with: `wip/<branch>`, then `-2`, `-3`.
 * `wip/` because a prefix sorts every parked branch together in a panel that groups on
 * slashes. Detached HEAD falls back to plain `wip`. A hyphen for the collision suffix,
 * not the underscore `suggestedLocalBranchName` uses, since this name already has a slash so there's no remote-branch confusion to avoid.
 */
export function suggestedWipBranchName(
  current: string | null,
  existing: readonly string[]
): string
{
  let base;
  if (current)
  {
    base = `wip/${current}`;
  }
  else
  {
    base = 'wip';
  }
  const taken = new Set(existing);
  if (!taken.has(base))
  {
    return base;
  }
  for (let i = 2; ; i++)
  {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate))
    {
      return candidate;
    }
  }
}
