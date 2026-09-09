/**
 * Resolve registry for native menu bar (built in main, no registry/stores available).
 * Pure function (separate from useMenuState's composable).
 */

import type { MenuItemStates } from '@shared/contract.js';
import { isImplemented, type CommandContext, type CommandDef } from '@renderer/commands/registry.js';

export function resolveStates(
  defs: readonly CommandDef<never>[],
  ctx: CommandContext
): MenuItemStates
{
  const states: MenuItemStates = {};
  for (const def of defs)
  {
    // Both reasons a row cannot be clicked, said as one: `when` is "not right now" and a
    // missing `run` is "not in this build". A menu greys them the same way.
    const enabled = isImplemented(def) && (!def.when || def.when(ctx));
    if (def.checked)
    {
      const state: MenuItemStates[string] = { enabled, checked: def.checked(ctx) };
      if (def.radioGroup)
      {
        state.radioGroup = def.radioGroup;
      }
      states[def.id] = state;
    }
    else
    {
      states[def.id] = { enabled };
    }
  }
  return states;
}
