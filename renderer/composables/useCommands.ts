/**
 * Wire registry to app: dispatch menu ids, bind hotkeys.
 * Context building is useCommandContext's job (re-exported for App.vue).
 */

import { onUnmounted } from 'vue';
import { runCommand, getCommand } from '@renderer/commands/registry.js';
import { api } from '@renderer/api.js';
import { useCommandHotkeys } from './useCommandHotkeys.js';
import { TOAST_TONE_INFO, useUiStore } from '@renderer/stores/ui.js';
import { useCommandContext } from './useCommandContext.js';

export { useCommandContext };

const EVENT_COMMAND = 'event:command';

export function useCommands()
{
  const ui = useUiStore();
  const context = useCommandContext();

  async function dispatch(id: string): Promise<void>
  {
    const ran = await runCommand(id, context.value);
    if (!ran)
    {
      // The label, not the id: `"repo.gc" is not available yet` shows the user an internal
      // name they have never seen anywhere else in the app.
      const label = getCommand(id)?.label ?? id;
      ui.toast(`${label.replace(/…$/, '')} is not available right now.`, TOAST_TONE_INFO);
    }
  }

  useCommandHotkeys({
    context,
    // Escape closes the topmost transient surface this window draws over itself. A dialog
    // is a window of its own and binds its own (`DialogHost`), so there is nothing here to
    // close for one.
    onEscape: () =>
    {
      if (ui.paletteOpen)
      {
        ui.closePalette();
      }
      else if (ui.confirmRequest)
      {
        ui.answerConfirm(false);
      }
    }
  });

  // The native menu sends command ids rather than performing actions itself.
  const offMenu = api.on(EVENT_COMMAND, (id) => void dispatch(id));
  onUnmounted(offMenu);

  return { context, dispatch };
}
