/**
 * Tell native menu what rows can do. Resolves when/checked here.
 * Split from useCommands: two directions, two reasons to change.
 */

import { computed, watch } from 'vue';
import type { ComputedRef } from 'vue';
import type { MenuItemStates } from '@shared/contract.js';
import { allCommands, type CommandContext } from '@renderer/commands/registry.js';
import { resolveStates } from '@renderer/menus/menuBarState.js';
import { api } from '@renderer/api.js';

export function useMenuState(context: ComputedRef<CommandContext>): void
{
  // A `computed` rather than a call on every context change, because `checked` mostly does
  // not read the context at all: it reads a setting, or the highlight override, neither of
  // which the context carries. Resolving inside a computed makes Vue track whatever each
  // predicate actually touched, so ticking a box in Settings redraws the menu.
  const states = computed<MenuItemStates>(() => resolveStates(allCommands(), context.value));

  // The computed is a fresh object every time, so the watcher fires whenever anything a
  // predicate reads moves, which is most keystrokes. Comparing the serialized map keeps
  // that off the wire: main would only find nothing to redraw anyway, one process later.
  let sent = '';
  watch(
    states,
    (next) =>
    {
      const serialized = JSON.stringify(next);
      if (serialized === sent)
      {
        return;
      }
      sent = serialized;
      void api['menu:state'](next);
    },
    { immediate: true }
  );
}
