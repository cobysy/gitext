/**
 * Left panel commands: arrangement and copying nodes.
 * Imports stores (and `renderer/api`), so kept separate from declared commands for unit testing.
 */

import { defineCommand, hasRepo, type CommandContext } from './registry.js';
import { api, toMessage } from '@renderer/api.js';
import { copyText } from '@renderer/clipboard.js';
import {
  DEFAULT_SECTIONS,
  KIND_BRANCH,
  KIND_REMOTE,
  KIND_REMOTE_BRANCH,
  KIND_SECTION,
  KIND_STASH,
  KIND_SUBMODULE,
  KIND_TAG,
  KIND_WORKTREE,
  type PanelNodeKind,
  type PanelSectionId,
  type PanelSort
} from '@renderer/panel.js';
import { toNativePath } from '@renderer/model/paths.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';


const SECTION_ID_PREFIX = 'section:';
const SORT_NAME = 'name';
const SORT_DATE = 'date';

function nodeIs(...kinds: PanelNodeKind[]): (c: CommandContext) => boolean
{
  return (c) => c.hasRepo && c.selectedNode !== null && kinds.includes(c.selectedNode.kind);
}

/**
 * Await a hand-off to the OS, and say so when it refuses. A worktree's directory can be
 * gone while its record is not, which is the case that would otherwise be silence.
 */
async function revealPath(work: Promise<void>): Promise<void>
{
  try
  {
    await work;
  }
  catch (error)
  {
    useUiStore().toast(toMessage(error), 'error');
  }
}

/**
 * The selected node's path, as the OS wants it.
 *
 * The panel carries both kinds: a worktree's path is absolute, a submodule's is
 * repo-relative, which is what git answers with. Handed to the OS unresolved, a
 * submodule's is a path relative to wherever the app happens to be running, and the
 * open silently does nothing.
 */
function selectedNodePath(): string | null
{
  const path = useRepoObjectsStore().selected?.path;
  const root = useRepoStore().repo?.path;
  if (!path || !root)
  {
    return null;
  }
  return toNativePath(root, path);
}

/** The section a section node stands for, or null when something else is selected. */
function selectedSection(): PanelSectionId | null
{
  const selected = useRepoObjectsStore().selected;
  if (!selected || selected.kind !== KIND_SECTION)
  {
    return null;
  }
  const id = selected.id.slice(SECTION_ID_PREFIX.length);
  if ((DEFAULT_SECTIONS as readonly string[]).includes(id))
  {
    return id as PanelSectionId;
  }
  else
  {
    return null;
  }
}

export function registerPanelCommands(): void
{
  // ── Copying what a node holds ───────────────────────────────────────────────
  defineCommand({
    id: 'panel.copyName',
    label: 'Copy Name',
    group: 'Left Panel',
    when: nodeIs(KIND_BRANCH, KIND_REMOTE_BRANCH, KIND_TAG, KIND_REMOTE, KIND_STASH),
    run: () =>
    {
      const node = useRepoObjectsStore().selected;
      // Use ref not label: nested branch labels are just the last segment, not the full path.
      const text = node?.ref ?? node?.label ?? '';
      if (text)
      {
        return copyText(text, 'name');
      }
      else
      {
        return undefined;
      }
    }
  });

  defineCommand({
    id: 'panel.copyUrl',
    label: 'Copy Remote URL',
    group: 'Left Panel',
    when: nodeIs(KIND_REMOTE),
    run: () =>
    {
      const url = useRepoObjectsStore().selected?.url;
      if (url)
      {
        return copyText(url, 'remote URL');
      }
      else
      {
        return undefined;
      }
    }
  });

  defineCommand({
    id: 'panel.copyPath',
    label: 'Copy Path',
    group: 'Left Panel',
    when: nodeIs(KIND_WORKTREE, KIND_SUBMODULE),
    run: () =>
    {
      // Rooted, like the row beside it: a path you paste into a terminal has to name the
      // same directory from wherever you paste it, and a submodule's own is relative.
      const path = selectedNodePath();
      if (path)
      {
        return copyText(path, 'path');
      }
      else
      {
        return undefined;
      }
    }
  });

  defineCommand({
    id: 'panel.showInFinder',
    label: 'Show in Finder',
    group: 'Left Panel',
    when: nodeIs(KIND_WORKTREE, KIND_SUBMODULE),
    run: () =>
    {
      const path = selectedNodePath();
      if (!path)
      {
        return undefined;
      }
      // `showItemInFolder`, not `openPath`: "Show" means the directory selected inside
      // its parent, which is the row you clicked pointed at on disk. Opening it instead
      // puts you inside it, with nothing saying which one you are in.
      return revealPath(api['repo:showItemInFolder'](path));
    }
  });

  // ── Arrangement ─────────────────────────────────────────────────────────────
  defineCommand({
    id: 'panel.moveSectionUp',
    label: 'Move Section Up',
    group: 'Left Panel',
    when: nodeIs(KIND_SECTION),
    run: () =>
    {
      const id = selectedSection();
      if (id)
      {
        return useRepoObjectsStore().moveSectionBy(id, -1);
      }
      else
      {
        return undefined;
      }
    }
  });

  defineCommand({
    id: 'panel.moveSectionDown',
    label: 'Move Section Down',
    group: 'Left Panel',
    when: nodeIs(KIND_SECTION),
    run: () =>
    {
      const id = selectedSection();
      if (id)
      {
        return useRepoObjectsStore().moveSectionBy(id, 1);
      }
      else
      {
        return undefined;
      }
    }
  });

  defineCommand({
    id: 'panel.expandAll',
    label: 'Expand All',
    group: 'Left Panel',
    when: hasRepo,
    run: () => useRepoObjectsStore().expandAll()
  });

  defineCommand({
    id: 'panel.collapseAll',
    label: 'Collapse All',
    group: 'Left Panel',
    when: hasRepo,
    run: () => useRepoObjectsStore().collapseAll()
  });

  // ── Sorting ─────────────────────────────────────────────────────────────────
  // Four commands, not key+direction: each row names what you'll see. Homed on panel's sort button, not menus.
  const sortIs = (sort: PanelSort, ascending: boolean) => (): boolean =>
  {
    const objects = useRepoObjectsStore();
    return objects.sort === sort && objects.ascending === ascending;
  };

  defineCommand({
    id: 'panel.sortNameAsc',
    label: 'Sort by Name (A-Z)',
    group: 'Left Panel',
    when: hasRepo,
    checked: sortIs(SORT_NAME, true),
    run: () => useRepoObjectsStore().setSortOrder(SORT_NAME, true)
  });

  defineCommand({
    id: 'panel.sortNameDesc',
    label: 'Sort by Name (Z-A)',
    group: 'Left Panel',
    when: hasRepo,
    checked: sortIs(SORT_NAME, false),
    run: () => useRepoObjectsStore().setSortOrder(SORT_NAME, false)
  });

  defineCommand({
    id: 'panel.sortNewestFirst',
    label: 'Sort by Newest Commit First',
    group: 'Left Panel',
    when: hasRepo,
    checked: sortIs(SORT_DATE, false),
    run: () => useRepoObjectsStore().setSortOrder(SORT_DATE, false)
  });

  defineCommand({
    id: 'panel.sortOldestFirst',
    label: 'Sort by Oldest Commit First',
    group: 'Left Panel',
    when: hasRepo,
    checked: sortIs(SORT_DATE, true),
    run: () => useRepoObjectsStore().setSortOrder(SORT_DATE, true)
  });
}
