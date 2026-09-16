/**
 * What the branch cleanup can compare against, and which of those it opens on.
 *
 * A remote-tracking branch is offered beside the local ones because that is where a
 * merge done on the server shows up first: after a fetch, `origin/main` has it while the
 * local `main` is still behind until someone pulls.
 */

import { REF_KIND_BRANCH, REF_KIND_REMOTE, type RefEntry } from '@shared/types.js';
import { DEFAULT_REMOTE_NAME } from './remoteDefaults.js';

/** The names work usually lands on, most likely first. */
const LANDING_NAMES = ['main', 'master', 'develop'];

export interface ComparisonOption {
  value: string;
  label: string;
}

/** Local branches first, then remote-tracking ones: the order the left panel lists them in. */
export function comparisonOptions(refs: readonly RefEntry[]): ComparisonOption[]
{
  const locals = refs.filter((ref) => ref.kind === REF_KIND_BRANCH);
  const remotes = refs.filter((ref) => ref.kind === REF_KIND_REMOTE);
  return [...locals, ...remotes].map((ref) => ({ value: ref.name, label: ref.name }));
}

/** `origin/main` for `main`, on whichever remote the ref belongs to. */
function isRemoteBranchNamed(ref: RefEntry, name: string): boolean
{
  return ref.kind === REF_KIND_REMOTE && ref.remote !== null && ref.name === `${ref.remote}/${name}`;
}

/**
 * The remote copy of one landing branch, if this repository has one: the local branch's
 * own upstream, else `origin`'s, else any remote's.
 */
function remoteCopyOf(refs: readonly RefEntry[], name: string): string | undefined
{
  const remoteNames = new Set(
    refs.filter((ref) => ref.kind === REF_KIND_REMOTE).map((ref) => ref.name)
  );
  const local = refs.find((ref) => ref.kind === REF_KIND_BRANCH && ref.name === name);
  if (local?.upstream && remoteNames.has(local.upstream))
  {
    return local.upstream;
  }
  const fromOrigin = `${DEFAULT_REMOTE_NAME}/${name}`;
  if (remoteNames.has(fromOrigin))
  {
    return fromOrigin;
  }
  return refs.find((ref) => isRemoteBranchNamed(ref, name))?.name;
}

/**
 * The comparison the dialog opens on: the remote copy of a usual landing branch, then the
 * local one, then whatever is checked out, which is at least a branch that exists.
 */
export function defaultComparison(refs: readonly RefEntry[]): string
{
  const locals = refs.filter((ref) => ref.kind === REF_KIND_BRANCH);
  for (const name of LANDING_NAMES)
  {
    const remote = remoteCopyOf(refs, name);
    if (remote)
    {
      return remote;
    }
    if (locals.some((ref) => ref.name === name))
    {
      return name;
    }
  }
  return locals.find((ref) => ref.isCurrent)?.name ?? locals[0]?.name ?? '';
}
