/**
 * The left panel tree: expansion, selection, filter, sort state. buildTree (in panel.ts) builds the tree itself.
 */

import { computed, ref } from 'vue';
import {
  DEFAULT_EXPANDED,
  buildTree,
  filterTree,
  flatten,
  isCurrentBranch,
  moveSection,
  normalizeSections,
  pathTo,
  sectionNodeId,
  walk,
  type FlatNode,
  type PanelNode,
  type PanelSectionId,
  type PanelSort,
  type RepoObjects
} from '@renderer/panel.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';

export interface TreeDeps {
  settings: ReturnType<typeof useSettingsStore>;
  /** The five object lists, the repo path, and the merged set: read fresh, never captured. */
  objects: () => RepoObjects;
}

export function createTreeState({ settings, objects }: TreeDeps)
{
  /** Node ids that are open. See `DEFAULT_EXPANDED`; everything else starts closed. */
  const expanded = ref(new Set<string>(DEFAULT_EXPANDED.map(sectionNodeId)));
  const selectedId = ref<string | null>(null);
  const filter = ref('');

  const sections = computed<PanelSectionId[]>(() =>
    normalizeSections(settings.settings.leftPanelSections)
  );
  const sort = computed<PanelSort>(() => settings.settings.leftPanelSort);
  const ascending = computed(() => settings.settings.leftPanelSortAscending);

  const tree = computed<PanelNode[]>(() =>
    buildTree(objects(), { sections: sections.value, sort: sort.value, ascending: ascending.value })
  );

  const visibleTree = computed<PanelNode[]>(() => filterTree(tree.value, filter.value));

  /**
   * The drawn rows. Filtered tree is fully expanded (don't make user open folders after searching).
   */
  const rows = computed<FlatNode[]>(() =>
    flatten(visibleTree.value, (node) =>
    {
      if (filter.value)
      {
        return true;
      }
      else
      {
        return expanded.value.has(node.id);
      }
    })
  );

  const selected = computed<PanelNode | null>(() =>
  {
    if (!selectedId.value)
    {
      return null;
    }
    for (const node of walk(visibleTree.value))
    {
      if (node.id === selectedId.value)
      {
        return node;
      }
    }
    return null;
  });

  function select(id: string | null): void
  {
    selectedId.value = id;
  }

  /**
   * Open to and select the checked-out branch. Without this, collapsed folders hide it.
   * Called on checkout (not on every reload, see revealCurrentBranch).
   */
  function selectCurrentBranch(): void
  {
    const chain = pathTo(tree.value, isCurrentBranch);
    // A detached HEAD has no current branch. Nothing to reveal, and nothing wrong.
    if (!chain)
    {
      return;
    }

    const next = new Set(expanded.value);
    // Everything but the branch itself: a leaf has nothing to expand.
    for (const node of chain.slice(0, -1))
    {
      next.add(node.id);
    }
    expanded.value = next;
    selectedId.value = chain[chain.length - 1]!.id;
  }

  /**
   * Open to current branch only if nothing is selected (used by reload, not checkout).
   */
  function revealCurrentBranch(): void
  {
    if (selectedId.value !== null)
    {
      return;
    }
    selectCurrentBranch();
  }

  function isExpanded(id: string): boolean
  {
    return expanded.value.has(id);
  }

  function toggleExpanded(id: string): void
  {
    const next = new Set(expanded.value);
    if (!next.delete(id))
    {
      next.add(id);
    }
    expanded.value = next;
  }

  function setExpanded(id: string, open: boolean): void
  {
    const next = new Set(expanded.value);
    if (open)
    {
      next.add(id);
    }
    else
    {
      next.delete(id);
    }
    expanded.value = next;
  }

  function expandAll(): void
  {
    const next = new Set<string>();
    for (const node of walk(tree.value))
    {
      if (node.children.length > 0)
      {
        next.add(node.id);
      }
    }
    expanded.value = next;
  }

  function collapseAll(): void
  {
    expanded.value = new Set();
  }

  async function moveSectionBy(id: PanelSectionId, direction: -1 | 1): Promise<void>
  {
    await settings.patch({ leftPanelSections: moveSection(sections.value, id, direction) });
  }

  /**
   * Set sort key and direction together (one call not two, for one write and re-sort per click).
   */
  async function setSortOrder(next: PanelSort, nextAscending: boolean): Promise<void>
  {
    await settings.patch({ leftPanelSort: next, leftPanelSortAscending: nextAscending });
  }

  function reset(): void
  {
    selectedId.value = null;
    filter.value = '';
  }

  return {
    expanded,
    selectedId,
    filter,
    sections,
    sort,
    ascending,
    tree,
    visibleTree,
    rows,
    selected,
    select,
    selectCurrentBranch,
    revealCurrentBranch,
    isExpanded,
    toggleExpanded,
    setExpanded,
    expandAll,
    collapseAll,
    moveSectionBy,
    setSortOrder,
    reset
  };
}
