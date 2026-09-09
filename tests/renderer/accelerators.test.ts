/**
 * Accelerators, and the scope that makes bare letters possible, over the *whole*
 * registry.
 *
 * The hotkey handler picks the first command whose keys match and whose scope admits
 * the focused pane, so two commands sharing a binding within one scope is not a
 * conflict the user can see: it is one of them silently never firing. Reachable only by
 * pressing the key with the right pane focused, which is exactly the sort of thing a
 * test should hold instead.
 *
 * Its own file, and not part of `menu.test.ts`, because of what it takes to see every
 * command. The resolver tests run on fixture commands under plain Node; this one needs
 * the real registry, every module of it, since a binding declared in a module the test
 * never imports is a binding nothing holds. `renderer/api.ts` builds its wrapper from
 * `window.git` at import time, which is the only thing standing between Node and the
 * command modules, so a stub for that one property is the whole setup: no store is
 * called, because registering a command runs neither its `when` nor its `run`.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { INVOKE_CHANNELS } from '@shared/contract.js';
import type { CommandDef, PaneId } from '@renderer/commands/registry.js';

/** The scope every unscoped binding shares: the whole window. */
const GLOBAL_SCOPE = 'global';

let bound: CommandDef[];
let scopePanes: (scope: CommandDef['scope']) => readonly PaneId[];
let getCommand: (id: string) => CommandDef | undefined;
let stagingListMenu: typeof import('@renderer/menus/staging.js')['stagingListMenu'];

beforeAll(async () =>
{
  const git: Record<string, unknown> = { on: () => () => undefined };
  for (const channel of INVOKE_CHANNELS)
  {
    git[channel] = () => Promise.resolve(undefined);
  }
  (globalThis as unknown as { window: unknown }).window = { git };

  const registry = await import('@renderer/commands/registry.js');
  const { registerCommands } = await import('@renderer/commands/index.js');
  registerCommands();

  bound = registry.allCommands().filter((command) => command.keys?.length);
  scopePanes = registry.scopePanes;
  getCommand = registry.getCommand;
  ({ stagingListMenu } = await import('@renderer/menus/staging.js'));
});

const walk = (nodes: readonly import('@renderer/menus/resolve.js').MenuNode[]): string[] =>
  nodes.flatMap((node) =>
  {
    if (node.kind === 'command')
    {
      return [node.id];
    }
    if (node.kind === 'submenu')
    {
      return walk(node.items);
    }
    return [];
  });

describe('accelerators', () =>
{
  it('sees every command module, not only the ones a menu test imports', () =>
  {
    // The assertion the rest of this file rests on. `copy.sha` held `Mod+Shift+S`
    // against `stash.save` for as long as no test could load the module it lives in.
    expect(bound.some((command) => command.id.startsWith('copy.'))).toBe(true);
    expect(bound.some((command) => command.id.startsWith('staging.'))).toBe(true);
    expect(bound.some((command) => command.id.startsWith('view.'))).toBe(true);
  });

  it('gives each accelerator to one command per scope', () =>
  {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const command of bound)
    {
      // Per *pane*, not per declaration: a command scoped to two panes occupies its key
      // in both, and the shadowing this catches is the hotkey handler taking whichever
      // of two matches it found first.
      let panes: readonly string[];
      if (command.scope)
      {
        panes = scopePanes(command.scope);
      }
      else
      {
        panes = [GLOBAL_SCOPE];
      }
      for (const key of command.keys ?? [])
      {
        for (const pane of panes)
        {
          const slot = `${pane} ${key}`;
          const first = seen.get(slot);
          if (first)
          {
            clashes.push(`${slot}: ${first} and ${command.id}`);
          }
          else
          {
            seen.set(slot, command.id);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('does not shadow a scoped binding with a window-wide one', () =>
  {
    // `R` resets a file in the file pane. If anything also claimed a bare `R` for the
    // whole window, whichever was declared first would win everywhere, which is the
    // failure the scope exists to prevent.
    const scopedKeys = new Set(
      bound.filter((command) => command.scope).flatMap((command) => command.keys ?? [])
    );
    const global = bound
      .filter((command) => !command.scope)
      .filter((command) => (command.keys ?? []).some((key) => scopedKeys.has(key)))
      .map((command) => command.id);
    expect(global).toEqual([]);
  });

  it('scopes every bare-letter binding to a pane', () =>
  {
    // A single unmodified character is a key someone will press while reading. It can
    // only mean an action if "where the focus is" is part of what it means.
    const bare = bound.filter((command) =>
      (command.keys ?? []).some((key) => /^[A-Z0-9]$/.test(key))
    );
    expect(bare.length).toBeGreaterThan(0);
    expect(bare.filter((command) => !command.scope).map((command) => command.id)).toEqual([]);
  });

  it('lets every keyed row of the commit screen menu be typed there', () =>
  {
    // `S` stages in both file lists. A row that shows an accelerator on a surface where
    // the accelerator does nothing is worse than a row showing none.
    const missing = walk(stagingListMenu)
      .map((id) => getCommand(id))
      .filter((command) => command?.keys?.length)
      .filter((command) => !scopePanes(command!.scope).includes('commitScreen'))
      .map((command) => command!.id);
    expect(missing).toEqual([]);
  });

  it('leaves Cmd+Space to the operating system', () =>
  {
    // macOS gives Cmd+Space to Spotlight, so a command holding it has no binding at
    // all: the keystroke never reaches the window.
    const taken = bound
      .filter((command) => (command.keys ?? []).includes('Mod+Space'))
      .map((command) => command.id);
    expect(taken).toEqual([]);
  });
});
