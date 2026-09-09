/**
 * Turning a declared menu into a menu that can be drawn. A menu is a tree of command
 * *ids*: no labels, no accelerators, no handlers (§7), so a label lives in exactly one place.
 *
 * Two kinds of "you can't click this" collapse into one greyed row: a `when` that
 * fails right now, and a command declared but not yet built. The user doesn't care which.
 *
 * The exception is a row not waiting for anything (Stage over a file from a two-year-old
 * commit): those declare `hideIfUnavailable` instead of `item`, and leave.
 *
 * Pure, importing only the registry, so separator collapsing, empty submenus and
 * unknown ids are unit-tested rather than only reachable by right-clicking.
 */

import { getCommand, isImplemented, type CommandContext } from '@renderer/commands/registry.js';

const KIND_COMMAND = 'command';
const KIND_SEPARATOR = 'separator';
const KIND_SUBMENU = 'submenu';

export type MenuNode =
  | {
    kind: 'command';
    id: string;
    /** See `hideIfUnavailable`. Absent, the usual case, means the row greys instead. */
    hideIfUnavailable?: true;
    /** See `operand`. Absent, the usual case, means the registry's label is used. */
    label?: string;
    /** See `operand`. Handed to `runCommand` when the row is clicked. */
    options?: unknown;
  }
  | { kind: 'separator' }
  | {
    kind: 'submenu';
    label: string;
    items: MenuNode[];
    /** See `submenu`. A submenu whose rows are data can legitimately have none. */
    greyWhenEmpty?: true;
  };

export interface ResolvedCommand {
  kind: 'command';
  id: string;
  label: string;
  /** Unformatted accelerator, e.g. `Mod+Shift+C`. Absent when the command has none. */
  accelerator?: string;
  enabled: boolean;
  /** Present only for stateful commands (`CommandDef.checked`). Absent means "not a toggle"; false means "off". */
  checked?: boolean;
  /** The operand this row names: see `operand`. Passed straight to `runCommand`. */
  options?: unknown;
}

export interface ResolvedSubmenu {
  kind: 'submenu';
  label: string;
  items: ResolvedItem[];
  /** False when nothing inside can be clicked, so the parent row greys with them. */
  enabled: boolean;
}

export type ResolvedItem = ResolvedCommand | ResolvedSubmenu | { kind: 'separator' };

/**
 * Just the command rows. A switch of buttons has no use for a separator or a submenu,
 * so it narrows here rather than each drawing surface re-testing `kind`.
 */
export function resolvedCommands(items: readonly ResolvedItem[]): ResolvedCommand[]
{
  return items.filter((entry): entry is ResolvedCommand => entry.kind === KIND_COMMAND);
}

/** Shorthand for a command row. */
export function item(id: string): MenuNode
{
  return { kind: 'command', id };
}

/**
 * A command row that leaves the menu when it doesn't apply, rather than greying in
 * it: "not now" (a greyed row) against "not here" (Stage over a file from a commit,
 * where there's no click that brings it back). A property of the *row*, not the
 * command: availability still lives on `when`, in one place; this only says what to do with the answer.
 */
export function hideIfUnavailable(id: string): MenuNode
{
  return { kind: 'command', id, hideIfUnavailable: true };
}

/**
 * A command row that names its own operand: for menus whose rows are *data* (the
 * branches on a right-clicked commit). The label is the operand, so the registry's own
 * label would say nothing new, and the operand travels with the click.
 */
export function operand(id: string, label: string, options: unknown): MenuNode
{
  return { kind: 'command', id, label, options };
}

export const separator: MenuNode = { kind: 'separator' };

/**
 * A submenu. `greyWhenEmpty` for one whose rows are data, not declarations: an empty
 * submenu is normally a bug (a typo'd id) and is dropped, but "no branches on this
 * commit" is a fact, greyed in place instead.
 */
export function submenu(
  label: string,
  items: MenuNode[],
  options: { greyWhenEmpty?: true } = {}
): MenuNode
{
  return { kind: 'submenu', label, items, ...options };
}

/**
 * Resolve a menu tree against the registry and the current context. An id with no
 * command behind it is dropped and warned about: rendering it as greyed would disguise a typo as a feature.
 */
/** True when a submenu row is still worth clicking, not a separator, and enabled. */
function isEnabledItem(item: ResolvedItem): boolean
{
  return item.kind !== KIND_SEPARATOR && item.enabled;
}

/** True when a command declares a `when` and it says no right now. */
function isUnavailable(when: ((ctx: CommandContext) => boolean) | undefined, ctx: CommandContext): boolean
{
  return !!when && !when(ctx);
}

export function resolveMenu(nodes: readonly MenuNode[], ctx: CommandContext): ResolvedItem[]
{
  const resolved: ResolvedItem[] = [];

  for (const node of nodes)
  {
    if (node.kind === KIND_SEPARATOR)
    {
      resolved.push(node);
      continue;
    }

    if (node.kind === KIND_SUBMENU)
    {
      const items = resolveMenu(node.items, ctx);
      // A submenu that resolved to nothing at all had only unknown ids in it: unless it
      // was declared as one that can legitimately be empty, which greys instead.
      if (items.length === 0)
      {
        if (!node.greyWhenEmpty)
        {
          continue;
        }
        resolved.push({ kind: 'submenu', label: node.label, items, enabled: false });
        continue;
      }
      resolved.push({
        kind: 'submenu',
        label: node.label,
        items,
        enabled: items.some(isEnabledItem)
      });
      continue;
    }

    const command = getCommand(node.id);
    if (!command)
    {
      console.warn(`Menu references unknown command id: ${node.id}`);
      continue;
    }

    // A handful of rows say "not here", not "not now", and leave rather than grey; the
    // unbuilt half of `enabled` below is deliberately not consulted here.
    if (node.hideIfUnavailable && isUnavailable(command.when, ctx))
    {
      continue;
    }

    const resolvedCommand: ResolvedItem = {
      kind: 'command',
      id: node.id,
      label: node.label ?? command.label,
      enabled: isImplemented(command) && !isUnavailable(command.when, ctx)
    };
    if (node.options !== undefined)
    {
      resolvedCommand.options = node.options;
    }
    if (command.keys?.[0] !== undefined)
    {
      resolvedCommand.accelerator = command.keys[0];
    }
    if (command.checked !== undefined)
    {
      resolvedCommand.checked = command.checked(ctx);
    }
    resolved.push(resolvedCommand);
  }

  return collapseSeparators(resolved);
}

/**
 * Drop leading and trailing separators and squash runs of them: a group can vanish
 * whole (every id unknown, a submenu resolved empty), leaving the rule beside it with nothing to divide.
 */
function collapseSeparators(items: readonly ResolvedItem[]): ResolvedItem[]
{
  const result: ResolvedItem[] = [];

  for (const entry of items)
  {
    if (entry.kind !== KIND_SEPARATOR)
    {
      result.push(entry);
      continue;
    }
    if (result.length === 0)
    {
      continue;
    }
    if (result[result.length - 1]!.kind === KIND_SEPARATOR)
    {
      continue;
    }
    result.push(entry);
  }

  while (result.length > 0 && result[result.length - 1]!.kind === KIND_SEPARATOR)
  {
    result.pop();
  }
  return result;
}
