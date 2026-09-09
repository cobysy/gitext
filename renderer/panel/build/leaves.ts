/** Leaf builder for each repo object: separate from folding/sorting logic. */

import type { RefEntry, StashEntry, SubmoduleEntry, WorktreeEntry } from '@shared/types.js';
import type { SortableLeaf } from './fold.js';
import type { PanelNode } from '../types.js';

/** Said on a ref whose commit is the selected one. */
const MERGED_SUFFIX = ': contained in the selected commit';

export function branchLeaf(ref: RefEntry, merged: ReadonlySet<string>): SortableLeaf
{
  let mergedSuffix: string;
  if (merged.has(ref.fullName))
  {
    mergedSuffix = MERGED_SUFFIX;
  }
  else
  {
    mergedSuffix = '';
  }
  const tracking = describeTracking(ref);
  const node: SortableLeaf['node'] = {
    id: `branch:${ref.fullName}`,
    kind: 'branch',
    label: ref.name,
    children: [],
    sha: ref.sha,
    ref: ref.name,
    fullName: ref.fullName,
    isCurrent: ref.isCurrent,
    isStale: ref.upstreamGone,
    isMerged: merged.has(ref.fullName),
    title: describeBranch(ref) + mergedSuffix
  };
  if (tracking)
  {
    node.detail = tracking;
  }
  return { sortName: ref.name, sortDate: ref.date, node };
}

export function remoteBranchLeaf(
  ref: RefEntry,
  pathWithinRemote: string,
  merged: ReadonlySet<string>
): SortableLeaf
{
  let mergedSuffix: string;
  if (merged.has(ref.fullName))
  {
    mergedSuffix = MERGED_SUFFIX;
  }
  else
  {
    mergedSuffix = '';
  }
  const node: PanelNode = {
    id: `remoteBranch:${ref.fullName}`,
    kind: 'remoteBranch',
    label: pathWithinRemote,
    children: [],
    sha: ref.sha,
    // The command operand is the full short name: `origin/main`, not `main`.
    ref: ref.name,
    fullName: ref.fullName,
    isMerged: merged.has(ref.fullName),
    title: ref.name + mergedSuffix
  };
  if (ref.remote)
  {
    node.remote = ref.remote;
  }
  return { sortName: pathWithinRemote, sortDate: ref.date, node };
}

export function tagLeaf(ref: RefEntry): SortableLeaf
{
  let annotatedSuffix: string;
  if (ref.isAnnotated)
  {
    annotatedSuffix = ' (annotated)';
  }
  else
  {
    annotatedSuffix = '';
  }
  return {
    sortName: ref.name,
    sortDate: ref.date,
    node: {
      id: `tag:${ref.fullName}`,
      kind: 'tag',
      label: ref.name,
      children: [],
      sha: ref.sha,
      ref: ref.name,
      fullName: ref.fullName,
      title: `${ref.name}${annotatedSuffix}`
    }
  };
}

export function stashLeaf(stash: StashEntry): SortableLeaf
{
  return {
    sortName: stash.name,
    sortDate: stash.date,
    node: {
      id: `stash:${stash.sha}`,
      kind: 'stash',
      label: stash.message,
      children: [],
      sha: stash.sha,
      // `stash@{0}` is what git takes as an argument, and it is positional.
      ref: stash.name,
      // Just the index: the message is the label and takes the width, and the full
      // selector truncates to "stas…", which says nothing at all.
      detail: `@{${stash.index}}`,
      title: `${stash.name}: ${stash.message}`
    }
  };
}

export function submoduleLeaf(submodule: SubmoduleEntry): SortableLeaf
{
  let detail: string;
  if (submodule.initialized)
  {
    detail = '';
  }
  else
  {
    detail = 'not initialized';
  }
  return {
    sortName: submodule.path,
    sortDate: 0,
    node: {
      id: `submodule:${submodule.name}`,
      kind: 'submodule',
      label: submodule.path,
      children: [],
      path: submodule.path,
      detail,
      isStale: !submodule.initialized,
      title: `${submodule.path}, ${submodule.url}`
    }
  };
}

export function worktreeLeaf(worktree: WorktreeEntry, repoPath: string): SortableLeaf
{
  const name = basename(worktree.path);
  let detailFallback: string;
  if (worktree.isBare)
  {
    detailFallback = 'bare';
  }
  else
  {
    detailFallback = shortSha(worktree.head);
  }
  let title: string;
  if (worktree.prunable)
  {
    title = `${worktree.path} (prunable)`;
  }
  else
  {
    title = worktree.path;
  }
  return {
    sortName: name,
    sortDate: 0,
    node: {
      id: `worktree:${worktree.path}`,
      kind: 'worktree',
      label: name,
      children: [],
      path: worktree.path,
      detail: worktree.branch ?? detailFallback,
      // The worktree this window is showing, which is the one that cannot be removed
      // from here, not `isMain`, which is about the repository rather than the window.
      isCurrent: worktree.path === repoPath,
      isStale: worktree.prunable,
      title
    }
  };
}

/** Full name, and what its upstream is doing: the part the row has no width for. */
function describeBranch(ref: RefEntry): string
{
  if (!ref.upstream)
  {
    return ref.name;
  }
  if (ref.upstreamGone)
  {
    return `${ref.name}: upstream ${ref.upstream} is gone`;
  }
  const tracking = describeTracking(ref);
  if (tracking)
  {
    return `${ref.name}: ${ref.ahead} ahead, ${ref.behind} behind ${ref.upstream}`;
  }
  else
  {
    return `${ref.name}: level with ${ref.upstream}`;
  }
}

/** `↑2 ↓1`, or nothing at all when a branch is level with its upstream. */
function describeTracking(ref: RefEntry): string
{
  if (ref.upstreamGone)
  {
    return 'gone';
  }
  const parts: string[] = [];
  if (ref.ahead > 0)
  {
    parts.push(`↑${ref.ahead}`);
  }
  if (ref.behind > 0)
  {
    parts.push(`↓${ref.behind}`);
  }
  return parts.join(' ');
}

function basename(path: string): string
{
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (cut === -1)
  {
    return path;
  }
  else
  {
    return path.slice(cut + 1);
  }
}

function shortSha(sha: string): string
{
  return sha.slice(0, 7);
}
