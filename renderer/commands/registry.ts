/**
 * The command registry (§7). One definition per user-visible action; the menu bar,
 * toolbar, context menus, hotkey handler and palette are all *renderings of this map*.
 *
 * A command that runs git declares `buildArgs`; the preview and the runner consume the
 * same array, so what's shown cannot drift from what runs (§8). A command may be
 * *declared before it's built* (label, group, `when`, no `run`), so a menu shows its
 * full shape early; `isImplemented` is the test.
 *
 * Imports nothing but vue, so everything resolving against it is unit-testable under
 * Node. Accelerator parsing, which needs the DOM, lives in `renderer/keys.ts`.
 */

import { reactive } from 'vue';
// Type-only, so the registry still pulls in nothing at runtime but vue.
import type { PanelNodeKind } from '@renderer/panel.js';
import type { FileStatusCode } from '@shared/types.js';

/** The panes a hotkey can be scoped to: where the keyboard is, not what's selected. Reports itself on `focusin`. */
export type PaneId = 'grid' | 'fileList' | 'diff' | 'leftPanel' | 'commitScreen';

/**
 * Predicate inputs for `when`: whether a command applies right now. Selection counts
 * live here since most grid commands want a particular count; without them a context menu greys as a block, saying nothing about why.
 */
export interface CommandContext {
  hasRepo: boolean;
  /**
   * Whether the open repository is a submodule of another (`superprojectPath` set):
   * here, not read per-`when`, since a predicate runs on every keystroke.
   */
  hasSuperproject: boolean;
  isMidOperation: boolean;
  hasChanges: boolean;
  /** How many revision-grid rows are selected. */
  selectionCount: number;
  /** Whether the selection includes a working-tree or index row: not commits, so a command taking a revision excludes them. */
  hasArtificialSelection: boolean;
  /**
   * What the left panel has selected, or null. The kind and two flags, not the node
   * itself: `when` runs on every keystroke and only asks what sort of thing it is.
   */
  selectedNode: {
    kind: PanelNodeKind;
    /** The checked-out branch, or the worktree this window has open. */
    isCurrent: boolean;
    /** A remote that has been switched off. Decides which way its menu's toggle reads. */
    isDisabled: boolean;
  } | null;
  /**
   * What the changed-files list has selected, or null. Status only: no working file
   * to open for a deleted one, nothing to stage for one already staged.
   */
  selectedFile: { status: FileStatusCode; isSubmodule: boolean } | null;
  /**
   * What the file list in front is a list *of*, or null. A row looks the same whether
   * it came from `git status` or a commit two years old, and staging the latter would
   * stage whatever is on disk now. The pivot's newer end, not the file's status: that
   * decides which of git's three copies a list shows.
   */
  fileSource: 'workingTree' | 'index' | 'commit' | null;
  /**
   * How many files the *file pane* has picked, zero when empty or hidden. Separate
   * from `stagingSelectionCount`: two lists, only one up at a time.
   */
  fileSelectionCount: number;
  /**
   * Which pane the keyboard is in, or null. Read only by commands with a `scope`: a
   * bare letter (`R` resets) is safe only inside its own surface.
   */
  focusedPane: PaneId | null;
  /**
   * Which of the commit screen's two lists the selection is in, or null when closed.
   * The main window has no side and offers both.
   */
  stagingSide: 'unstaged' | 'staged' | null;
  /** How many files the commit screen has picked. Zero when it is closed. */
  stagingSelectionCount: number;
}

/** The `when` every command needing an open repository shares. */
export const hasRepo = (c: Pick<CommandContext, 'hasRepo'>): boolean => c.hasRepo;

/** A file is selected in the changed-files list, on a repository that is open. */
export const hasFile = (c: Pick<CommandContext, 'hasRepo' | 'selectedFile'>): boolean =>
  c.hasRepo && c.selectedFile !== null;

export interface CommandDef<O = void> {
  id: string;
  label: string;
  /** Grouping label shown in the palette. */
  group: string;
  /** Fixed accelerators. Not user-configurable by design. */
  keys?: string[];
  /**
   * The pane(s) whose keyboard these `keys` belong to. Omitted means the whole window.
   * `Mod+Shift+B` can be global, `R` cannot: a scoped hotkey fires only while its pane
   * has focus; the menu row still runs wherever the focus is.
   */
  scope?: PaneId | readonly PaneId[];
  when?: (ctx: CommandContext) => boolean;
  /**
   * Whether this command's state is currently *on*: the tick beside a menu row, only
   * for a toggle. `when` is whether the row can be clicked; this is what clicking it
   * last left behind.
   */
  checked?: (ctx: CommandContext) => boolean;
  /**
   * Names the pick-one set this command belongs to, for surfaces that draw the two
   * differently. macOS marks a radio and a checkbox with different glyphs on purpose: a
   * checkbox says "independent", a radio says "one of these". Branch scope, diff mode and
   * the file-list shape are all pick-one and were drawn as loose checkboxes.
   */
  radioGroup?: string;
  /**
   * Build the git argv for this command. Pure: must not spawn, prompt, or mutate.
   * Commands that open a dialog rather than running git directly omit this.
   */
  buildArgs?: (options: O) => string[];
  /**
   * Perform the action. Omitted for a command that is declared but not yet built. The
   * return value is ignored; `unknown` so handlers can be one-liners.
   */
  run?: (options: O) => unknown;
}

// `any` here is deliberate: the map is heterogeneous over each command's option
// type, and the type parameter is recovered at the `getCommand<O>` call site.
/* eslint-disable @typescript-eslint/no-explicit-any */
const registry = reactive(new Map<string, CommandDef<any>>());

/** A scope as a list, whichever of the three shapes it was written in. */
export function scopePanes(scope: CommandDef['scope']): readonly PaneId[]
{
  if (scope === undefined)
  {
    return [];
  }
  if (typeof scope === 'string')
  {
    return [scope];
  }
  else
  {
    return scope;
  }
}

/**
 * Whether a binding fires with the keyboard in this pane. Unscoped is the whole window;
 * `null` cannot match a scope, so a bare letter does nothing until a pane claims focus.
 */
export function scopeAllows(scope: CommandDef['scope'], pane: PaneId | null): boolean
{
  if (scope === undefined)
  {
    return true;
  }
  return pane !== null && scopePanes(scope).includes(pane);
}

export function defineCommand<O = void>(def: CommandDef<O>): CommandDef<O>
{
  if (registry.has(def.id))
  {
    throw new Error(`Duplicate command id: ${def.id}`);
  }
  registry.set(def.id, def);
  return def;
}

/**
 * Declare a command a later phase will build: label and availability, no `run`. Draws
 * greyed in menus, stays out of the palette and hotkeys until built.
 */
export function declareCommand(
  id: string,
  label: string,
  group: string,
  when?: (ctx: CommandContext) => boolean,
  keys?: string[],
  scope?: PaneId | readonly PaneId[]
): void
{
  defineCommand({ id, label, group, when, keys, scope });
}

/**
 * Add `run` to a command that was previously only declared. Keeps the declaration file
 * Node-pure; a separate actions file supplies the implementation.
 */
export function implementCommand<O = void>(id: string, run: (options: O) => unknown): void
{
  const existing = registry.get(id);
  if (!existing)
  {
    throw new Error(`implementCommand: unknown command id "${id}"`);
  }
  if (existing.run)
  {
    throw new Error(`implementCommand: command "${id}" is already implemented`);
  }
  (existing as CommandDef<O>).run = run;
}

export function getCommand<O = void>(id: string): CommandDef<O> | undefined
{
  return registry.get(id) as CommandDef<O> | undefined;
}

export function allCommands(): CommandDef<any>[]
{
  return [...registry.values()];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Whether a command can actually be invoked, not merely declared. `when` says "not
 * right now"; this says "not in this build yet". A menu greys both.
 */
export function isImplemented(def: Pick<CommandDef<never>, 'run'>): boolean
{
  return def.run !== undefined;
}

/**
 * Commands that can run right now: built, and passing `when`. For the hotkey handler
 * and palette; a context menu deliberately skips this so its shape stays put.
 */
export function availableCommands(ctx: CommandContext): CommandDef[]
{
  return allCommands().filter((c) => isImplemented(c) && (!c.when || c.when(ctx)));
}

/**
 * Look up and run a command by id. False when the id is unknown or unavailable, so the
 * native menu can report that rather than failing silently.
 */
/**
 * Told about every command that runs, or nothing.
 *
 * Injected rather than imported: this module has to stay loadable under Node, which is
 * what lets `menu.test.ts` and `commandHomes.test.ts` load the whole registry and hold
 * every command to having a home. Reaching for `renderer/api.ts` from here would read
 * `window.git` at import time and end that.
 *
 * Every menu, hotkey, palette entry, toolbar button and context menu resolves through
 * `runCommand`, so this is the one place that can say what the user actually asked for:
 * a diagnostics report built from git alone only ever shows the consequences.
 */
let observer: ((id: string) => void) | null = null;

export function observeCommands(fn: (id: string) => void): void
{
  observer = fn;
}

export async function runCommand(
  id: string,
  ctx: CommandContext,
  options?: unknown
): Promise<boolean>
{
  const command = registry.get(id);
  if (!command?.run)
  {
    return false;
  }
  if (command.when && !command.when(ctx))
  {
    return false;
  }
  observer?.(id);
  await command.run(options);
  return true;
}

