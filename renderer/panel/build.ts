/**
 * Build panel tree: composition root (sections) delegating to leaves.ts and fold.ts.
 */

import {
  REF_KIND_BRANCH,
  REF_KIND_REMOTE,
  REF_KIND_TAG,
  type RefEntry,
  type RemoteEntry
} from '@shared/types.js';
import { SECTION_LABELS, sectionNodeId, type PanelNode, type PanelSectionId, type RepoObjects, type TreeOptions } from './types.js';
import { foldPaths, sortLeaves } from './build/fold.js';
import {
  branchLeaf,
  remoteBranchLeaf,
  stashLeaf,
  submoduleLeaf,
  tagLeaf,
  worktreeLeaf
} from './build/leaves.js';

/**
 * Which refs to mark as merged into `atSha`.
 *
 * git's `--merged` includes the refs that point *at* the commit itself, which is true
 * but useless: a branch is not "already contained in" the commit it is. Without dropping
 * them, every branch you click on marks itself as
 * finished with.
 */
export function markMerged(
  merged: readonly string[],
  refs: readonly RefEntry[],
  atSha: string | null
): Set<string>
{
  let atCommitNames: string[];
  if (atSha === null)
  {
    atCommitNames = [];
  }
  else
  {
    atCommitNames = refs.filter((ref) => ref.sha === atSha).map((ref) => ref.fullName);
  }
  const atCommit = new Set(atCommitNames);
  return new Set(merged.filter((fullName) => !atCommit.has(fullName)));
}

const EMPTY_MERGED: ReadonlySet<string> = new Set<string>();


const SECTION_BRANCHES = 'branches';
const SECTION_REMOTES = 'remotes';
const SECTION_TAGS = 'tags';
const SECTION_STASHES = 'stashes';
const SECTION_SUBMODULES = 'submodules';
const SECTION_WORKTREES = 'worktrees';

/** Build the whole panel: every section, in its configured order. */
export function buildTree(objects: RepoObjects, options: TreeOptions): PanelNode[]
{
  return options.sections.map((id) => buildSection(id, objects, options));
}

function buildSection(id: PanelSectionId, objects: RepoObjects, options: TreeOptions): PanelNode
{
  return {
    id: sectionNodeId(id),
    kind: 'section',
    label: SECTION_LABELS[id],
    children: sectionChildren(id, objects, options)
  };
}

function sectionChildren(
  id: PanelSectionId,
  objects: RepoObjects,
  options: TreeOptions
): PanelNode[]
{
  switch (id)
  {
    case SECTION_BRANCHES:
      return foldPaths(
        objects.refs
          .filter((r) => r.kind === REF_KIND_BRANCH)
          .map((ref) => branchLeaf(ref, objects.mergedRefs ?? EMPTY_MERGED)),
        SECTION_BRANCHES,
        options
      );
    case SECTION_REMOTES:
      return buildRemotes(objects, options);
    case SECTION_TAGS:
      return foldPaths(
        objects.refs.filter((r) => r.kind === REF_KIND_TAG).map(tagLeaf),
        SECTION_TAGS,
        options
      );
    case SECTION_STASHES:
      // Never sorted by name: the stack order *is* the meaning, and `stash@{1}` is
      // only addressable by its position in it.
      return objects.stashes.map(stashLeaf).map((entry) => entry.node);
    case SECTION_SUBMODULES:
      return foldPaths(objects.submodules.map(submoduleLeaf), SECTION_SUBMODULES, options);
    case SECTION_WORKTREES:
      return sortLeaves(
        objects.worktrees.map((w) => worktreeLeaf(w, objects.repoPath)),
        options
      ).map((entry) => entry.node);
  }
}

/** The folder deactivated remotes sit in. */
export const INACTIVE_REMOTES_ID = 'remotes:inactive';

function buildRemotes(objects: RepoObjects, options: TreeOptions): PanelNode[]
{
  const branchesByRemote = new Map<string, RefEntry[]>();
  for (const ref of objects.refs)
  {
    if (ref.kind !== REF_KIND_REMOTE || !ref.remote)
    {
      continue;
    }
    const list = branchesByRemote.get(ref.remote) ?? [];
    list.push(ref);
    branchesByRemote.set(ref.remote, list);
  }

  const leafFor = (remote: RemoteEntry) =>
  {
    // Both URLs only when they differ, which is the case worth noticing.
    let title: string;
    if (remote.pushUrl === remote.fetchUrl)
    {
      title = remote.fetchUrl;
    }
    else
    {
      title = `fetch: ${remote.fetchUrl}\npush: ${remote.pushUrl}`;
    }
    // A deactivated remote has no children, and the reason is not a choice made here:
    // git does not recognise its config section, so it fetches nothing and has no
    // tracking refs for the panel to list. Switching it back on brings them back with
    // the next fetch.
    let children: PanelNode[];
    if (remote.disabled)
    {
      children = [];
    }
    else
    {
      children = foldPaths(
        (branchesByRemote.get(remote.name) ?? []).map((ref) =>
          // Strip the remote prefix: the branch is already under its remote's node,
          // and repeating `origin/` on every child says nothing.
          remoteBranchLeaf(ref, ref.name.slice(remote.name.length + 1), objects.mergedRefs ?? EMPTY_MERGED)
        ),
        `remote:${remote.name}`,
        options
      );
    }
    return {
      sortName: remote.name,
      sortDate: 0,
      node: {
        id: `remote:${remote.name}`,
        kind: 'remote' as const,
        label: remote.name,
        detail: remote.fetchUrl,
        url: remote.fetchUrl,
        isDisabled: remote.disabled,
        title,
        children
      }
    };
  };

  const enabled = objects.remotes.filter((remote) => !remote.disabled).map(leafFor);
  const disabled = objects.remotes.filter((remote) => remote.disabled).map(leafFor);

  const active = sortLeaves(enabled, options).map((entry) => entry.node);
  if (disabled.length === 0)
  {
    return active;
  }

  // Grouped under one folder at the bottom rather than mixed in greyed out: a deactivated
  // remote is not a thing you are working with, so it should not sit between two that
  // you are.
  return [
    ...active,
    {
      id: INACTIVE_REMOTES_ID,
      kind: 'folder',
      label: 'Inactive',
      detail: `${disabled.length} deactivated`,
      title: 'git ignores these until they are activated again.',
      children: sortLeaves(disabled, options).map((entry) => entry.node)
    }
  ];
}
