/**
 * Main toolbar: command ids resolved against registry (like menus).
 * Muscle memory, so contents don't move as features land (grayed until built).
 */

import type { CommandContext } from '@renderer/commands/registry.js';
import { currentBranchMenu, type BranchChoice } from './currentBranch.js';
import { maintenanceMenu } from './maintenance.js';
import { item, resolveMenu, type MenuNode, type ResolvedItem } from './resolve.js';

const KIND_SEPARATOR = 'separator';
const KIND_DROPDOWN = 'dropdown';
const KIND_COMMAND = 'command';

/**
 * Toolbar entry. Dropdown: button that opens a small menu (not a split button).
 */
export type ToolbarNode =
  | {
    kind: 'button';
    id: string;
    /**
       * Draw the working tree's changed-file count on this button. Only Commit has
       * one: the count is what tells you there is something to commit, and a badge on
       * a button whose action does not consume it would be noise.
       */
    badge?: boolean;
  }
  | {
    kind: 'dropdown';
    id: string;
    label: string;
    items: MenuNode[];
    /**
       * Take the label from the repository instead of the constant above, which then
       * stands in only until one is open. The branch button is the toolbar's one control
       * naming a thing rather than an action, and what it names moves.
       */
    dynamicLabel?: boolean;
  }
  | { kind: 'separator' };

export type ResolvedToolbarItem =
  | {
    kind: 'button';
    id: string;
    label: string;
    accelerator?: string;
    enabled: boolean;
    badge: boolean;
  }
  | {
    kind: 'dropdown';
    id: string;
    label: string;
    enabled: boolean;
    items: ResolvedItem[];
    dynamicLabel: boolean;
  }
  | { kind: 'separator' };

function button(id: string, badge = false): ToolbarNode
{
  const node: ToolbarNode = { kind: 'button', id };
  if (badge)
  {
    node.badge = badge;
  }
  return node;
}

const separator: ToolbarNode = { kind: 'separator' };

/**
 * Grouped by operation: record, exchange, park, refresh, manage, folder.
 */
/**
 * Function, not constant, for the same reason `revisionGridMenu` is: one entry's rows are
 * data. The branch button lists the branches you can switch to, so the toolbar cannot be
 * written down until they are known.
 */
export function mainToolbar(branches: readonly BranchChoice[] = []): ToolbarNode[]
{
  return [
  // Which branch you are on, and the ones you could be on instead. The toolbar had no
  // branch operation at all: the answer to "where do I switch branch" was the menu bar, or
  // knowing that the left panel's rows answer a right-click.
    {
      kind: 'dropdown',
      id: 'branch',
      label: 'Branch',
      dynamicLabel: true,
      // The status bar's branch menu, from the one declaration: both controls name the
      // branch you are on, so both open the same list and the same operations.
      items: currentBranchMenu(branches)
    },
    separator,
    button('commit.open', true),
    separator,
    button('remote.pull'),
    button('remote.push'),
    button('remote.fetchAll'),
    separator,
    {
      kind: 'dropdown',
      id: 'stash',
      label: 'Stash',
      items: [item('stash.save'), item('stash.manage')]
    },
    separator,
    button('view.refresh'),
    separator,
    button('submodule.manage'),
    button('worktree.manage'),
    separator,
    {
      kind: 'dropdown',
      id: 'maintenance',
      label: 'Maintenance',
      items: maintenanceMenu
    },
    separator,
    button('repo.reveal'),
    separator,
    button('settings.open')
  ];
}

/**
 * Resolve toolbar against registry and context. Dropdowns with no rows disappear.
 */
export function resolveToolbar(
  nodes: readonly ToolbarNode[],
  ctx: CommandContext
): ResolvedToolbarItem[]
{
  const resolved: ResolvedToolbarItem[] = [];

  for (const node of nodes)
  {
    if (node.kind === KIND_SEPARATOR)
    {
      resolved.push(node);
      continue;
    }

    if (node.kind === KIND_DROPDOWN)
    {
      const items = resolveMenu(node.items, ctx);
      if (items.length === 0)
      {
        continue;
      }
      resolved.push({
        kind: 'dropdown',
        id: node.id,
        label: node.label,
        items,
        dynamicLabel: node.dynamicLabel === true,
        enabled: items.some((i) => i.kind !== KIND_SEPARATOR && i.enabled)
      });
      continue;
    }

    const [row] = resolveMenu([item(node.id)], ctx);
    if (row?.kind !== KIND_COMMAND)
    {
      continue;
    }
    const resolvedButton: ResolvedToolbarItem & { kind: 'button' } = {
      kind: 'button',
      id: row.id,
      label: row.label,
      enabled: row.enabled,
      badge: node.badge === true
    };
    if (row.accelerator !== undefined)
    {
      resolvedButton.accelerator = row.accelerator;
    }
    resolved.push(resolvedButton);
  }

  return resolved;
}
