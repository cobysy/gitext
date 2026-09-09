/**
 * Bind registry's fixed accelerators to window's keyboard.
 * Split from useCommands: commit screen needs hotkeys, not menu dispatch (would run twice).
 */

import { onMounted, onUnmounted, type Ref } from 'vue';
import { availableCommands, runCommand, scopeAllows } from '@renderer/commands/registry.js';
import { KEY_ESCAPE, TAG_TEXTAREA, eventToAccelerator } from '@renderer/keys.js';
import type { CommandContext } from '@renderer/commands/registry.js';

const TAG_INPUT = 'INPUT';
const ACCELERATOR_MOD_PREFIX = 'Mod';

export interface CommandHotkeyOptions {
  context: Ref<CommandContext>;
  /**
   * What Escape closes in this window, or omitted where something else owns it.
   *
   * The repository window closes its palette or answers its confirmation; the commit screen
   * has its own Escape (`useScreenKeyboard`) that knows about its dropdown, so it passes
   * nothing and this stays out of the way.
   */
  onEscape?: () => void;
}

export function useCommandHotkeys(opts: CommandHotkeyOptions)
{
  function onKeydown(event: KeyboardEvent): void
  {
    // A handler that already acted on this key has said so. The commit screen's own
    // keyboard runs first and calls `preventDefault` for the keys it owns, so this and it
    // cannot both fire for one press, which is what would otherwise focus a pane twice.
    if (event.defaultPrevented)
    {
      return;
    }

    // Let the focused control handle its own typing.
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === TAG_INPUT ||
      target?.tagName === TAG_TEXTAREA ||
      target?.isContentEditable === true;

    const accelerator = eventToAccelerator(event);

    // Escape always closes the topmost transient surface in *this* window, even while
    // typing.
    if (event.key === KEY_ESCAPE)
    {
      opts.onEscape?.();
      return;
    }

    if (typing && !accelerator.startsWith(ACCELERATOR_MOD_PREFIX))
    {
      return;
    }

    // A scoped binding belongs to the keyboards of the panes it names: `R` resets a file
    // in the file pane and on the commit screen, and means nothing over the grid. Without
    // the scope check a bare letter would be a window-wide accelerator, which is why
    // there were none before now.
    const match = availableCommands(opts.context.value).find(
      (c) => c.keys?.includes(accelerator) && scopeAllows(c.scope, opts.context.value.focusedPane)
    );
    if (!match)
    {
      return;
    }

    event.preventDefault();
    void runCommand(match.id, opts.context.value);
  }

  onMounted(() =>
  {
    window.addEventListener('keydown', onKeydown);
  });

  onUnmounted(() =>
  {
    window.removeEventListener('keydown', onKeydown);
  });
}
