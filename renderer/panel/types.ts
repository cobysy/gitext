/**
 * The left panel's shapes: its sections, its tree node, and the options a build of
 * the tree takes. No logic here: `sections.ts` reconciles a persisted section order
 * against these, `build.ts` turns repository objects into the tree, `traverse.ts`
 * walks the result.
 */

import type {
  RefEntry,
  RemoteEntry,
  StashEntry,
  SubmoduleEntry,
  WorktreeEntry
} from '@shared/types.js';

export type PanelSectionId =
  | 'branches'
  | 'remotes'
  | 'worktrees'
  | 'tags'
  | 'submodules'
  | 'stashes';

/** Default order. Unknown-to-stored sections append here. */
export const DEFAULT_SECTIONS: readonly PanelSectionId[] = [
  'branches',
  'remotes',
  'worktrees',
  'tags',
  'submodules',
  'stashes'
];

export const SECTION_LABELS: Record<PanelSectionId, string> = {
  branches: 'Branches',
  remotes: 'Remotes',
  worktrees: 'Worktrees',
  tags: 'Tags',
  submodules: 'Submodules',
  stashes: 'Stashes'
};

/** What each section holds, for drawing it where there is no room for its name. */
export const SECTION_KINDS: Record<PanelSectionId, PanelNodeKind> = {
  branches: 'branch',
  remotes: 'remote',
  worktrees: 'worktree',
  tags: 'tag',
  submodules: 'submodule',
  stashes: 'stash'
};

/** A section's node id. One place builds it, so nothing else has to know the format. */
export const sectionNodeId = (id: PanelSectionId): string => `section:${id}`;

/**
 * Sections open when a repository is first shown: branches (what the panel is for),
 * remotes (where a fetch/compare target lives), and worktrees (this window's own is
 * marked current, and a marker inside a collapsed section marks nothing). Tags,
 * submodules and stashes stay closed: lists you go looking for, often empty.
 */
export const DEFAULT_EXPANDED: readonly PanelSectionId[] = ['branches', 'remotes', 'worktrees'];

export const KIND_SECTION = 'section' as const;
export const KIND_FOLDER = 'folder' as const;
export const KIND_BRANCH = 'branch' as const;
export const KIND_REMOTE = 'remote' as const;
export const KIND_REMOTE_BRANCH = 'remoteBranch' as const;
export const KIND_TAG = 'tag' as const;
export const KIND_STASH = 'stash' as const;
export const KIND_SUBMODULE = 'submodule' as const;
export const KIND_WORKTREE = 'worktree' as const;

export type PanelNodeKind =
  | typeof KIND_SECTION
  | typeof KIND_FOLDER
  | typeof KIND_BRANCH
  | typeof KIND_REMOTE
  | typeof KIND_REMOTE_BRANCH
  | typeof KIND_TAG
  | typeof KIND_STASH
  | typeof KIND_SUBMODULE
  | typeof KIND_WORKTREE;

/** One row of the panel. Sections are nodes too, so the tree has a single shape. */
export interface PanelNode {
  /** Stable across reloads: expansion and selection are keyed by it. */
  id: string;
  kind: PanelNodeKind;
  label: string;
  children: PanelNode[];
  /** Commit to select in the grid when the node is activated. */
  sha?: string;
  /** Short ref name a command operates on: `feature/x`, `origin/main`, `v1`. */
  ref?: string;
  /** Full ref name (`refs/heads/feature/x`), where the node is a ref. */
  fullName?: string;
  /** Muted annotation on the right: divergence, a path, the remote's URL. */
  detail?: string;
  /** Hover text: the annotation beside a label is truncated by the panel's width, a URL almost always is, so the whole of it lives here. */
  title?: string;
  /** The checked-out branch, or the worktree this window has open. */
  isCurrent?: boolean;
  /** Configured but broken: an upstream that is gone, a prunable worktree. */
  isStale?: boolean;
  /** A remote switched off: its config section is `-remote.<name>`. Not `isStale`: nothing is broken, it's told to be left alone, and keeps its URL. */
  isDisabled?: boolean;
  /** The branch is already contained in the selected commit: what answers "is this branch finished with?". */
  isMerged?: boolean;
  /** Filesystem path, for worktree and submodule nodes. */
  path?: string;
  /** Fetch URL, for remote nodes. */
  url?: string;
  /** Which remote a remote-branch node came from. */
  remote?: string;
}

export type PanelSort = 'name' | 'date';

export interface TreeOptions {
  /** The section order. Every section in it is drawn; there is no hiding. */
  sections: readonly PanelSectionId[];
  sort: PanelSort;
  ascending: boolean;
}

export interface RepoObjects {
  refs: readonly RefEntry[];
  remotes: readonly RemoteEntry[];
  stashes: readonly StashEntry[];
  submodules: readonly SubmoduleEntry[];
  worktrees: readonly WorktreeEntry[];
  /** Absolute path of the repository this window has open, to mark its worktree. */
  repoPath: string;
  /** Full names of refs already contained in the selected commit. See `markMerged`. */
  mergedRefs?: ReadonlySet<string>;
}

/** Flatten to the rows actually drawn, honouring which nodes are expanded. A flat list, not nested elements, so keyboard movement is one index step, as in the grid. */
export interface FlatNode {
  node: PanelNode;
  depth: number;
  /** True when the node has children: the disclosure triangle's condition. */
  expandable: boolean;
  expanded: boolean;
}
