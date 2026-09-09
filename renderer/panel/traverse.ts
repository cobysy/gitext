/** Panel tree traversal and filtering. */

import {
  KIND_BRANCH,
  KIND_REMOTE_BRANCH,
  KIND_SECTION,
  KIND_STASH,
  KIND_SUBMODULE,
  KIND_TAG,
  KIND_WORKTREE,
  type FlatNode,
  type PanelNode,
  type PanelNodeKind
} from './types.js';

/**
 * Double-click command per node kind. Tag is create branch not checkout
 * (detached HEAD would be accidental). Sections/folders expand instead.
 */
export function activationCommand(kind: PanelNodeKind): string | null
{
  switch (kind)
  {
    case KIND_BRANCH:
    case KIND_REMOTE_BRANCH:
      return 'ref.checkout';
    case KIND_TAG:
      return 'ref.createBranch';
    case KIND_STASH:
      return 'stash.open';
    case KIND_SUBMODULE:
      return 'submodule.open';
    case KIND_WORKTREE:
      return 'worktree.open';
    default:
      return null;
  }
}

/**
 * Path from root to first matching node. Panel reveals by expanding all but the last,
 * then selecting it. Null if no match (e.g., detached HEAD).
 */
export function pathTo(
  nodes: readonly PanelNode[],
  match: (node: PanelNode) => boolean
): PanelNode[] | null
{
  for (const node of nodes)
  {
    if (match(node))
    {
      return [node];
    }
    const below = pathTo(node.children, match);
    if (below)
    {
      return [node, ...below];
    }
  }
  return null;
}

/** The checked-out branch, wherever it is folded away. */
export const isCurrentBranch = (node: PanelNode): boolean =>
  node.kind === KIND_BRANCH && node.isCurrent === true;

/** Depth-first walk of a built tree, parents before children. */
export function* walk(nodes: readonly PanelNode[]): Generator<PanelNode>
{
  for (const node of nodes)
  {
    yield node;
    yield* walk(node.children);
  }
}

export function flatten(
  nodes: readonly PanelNode[],
  isExpanded: (node: PanelNode) => boolean,
  depth = 0
): FlatNode[]
{
  const rows: FlatNode[] = [];
  for (const node of nodes)
  {
    const expandable = node.children.length > 0;
    const expanded = expandable && isExpanded(node);
    rows.push({ node, depth, expandable, expanded });
    if (expanded)
    {
      rows.push(...flatten(node.children, isExpanded, depth + 1));
    }
  }
  return rows;
}

/**
 * Filter by substring of label or ref. Folders survive if children match;
 * sections always survive (prevents panel jumping while typing).
 */
export function filterTree(nodes: readonly PanelNode[], query: string): PanelNode[]
{
  const needle = query.trim().toLowerCase();
  if (!needle)
  {
    return [...nodes];
  }

  const matches = (node: PanelNode): boolean =>
    node.label.toLowerCase().includes(needle) || (node.ref?.toLowerCase().includes(needle) ?? false);

  const prune = (node: PanelNode): PanelNode | null =>
  {
    const children = node.children.map(prune).filter((c): c is PanelNode => c !== null);
    if (node.kind === KIND_SECTION)
    {
      return { ...node, children };
    }
    if (children.length > 0)
    {
      return { ...node, children };
    }
    if (matches(node))
    {
      return { ...node, children: [] };
    }
    else
    {
      return null;
    }
  };

  return nodes.map(prune).filter((n): n is PanelNode => n !== null);
}
