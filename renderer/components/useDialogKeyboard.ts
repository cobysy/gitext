/**
 * The dialog window's own keyboard: Escape closes it (or answers a confirm first),
 * Enter presses the primary action. Waits for `ready` itself before attaching anything,
 * so the initial focus lands only once there is a control to take it.
 */

import { nextTick, onUnmounted, watch, type Ref } from 'vue';
import type { useUiStore } from '@renderer/stores/ui.js';
import { KEY_ENTER, KEY_ESCAPE, TAG_TEXTAREA } from '@renderer/keys.js';

const TAG_BUTTON = 'BUTTON';

export interface DialogKeyboardDeps {
  ui: ReturnType<typeof useUiStore>;
  ready: Ref<boolean>;
  close: () => void;
}

export function useDialogKeyboard({ ui, ready, close }: DialogKeyboardDeps): void
{
  /** Cleared when the window goes, so nothing started here keeps running without it. */
  let mounted = true;

  /**
   * Enter presses the dialog's primary action, found rather than raised by an event the
   * dialog has to emit: every dialog already marks its confirming button `primary` or
   * `danger` in the frame's footer. A disabled button is left alone.
   */
  function pressPrimary(): void
  {
    const button = document.querySelector<HTMLButtonElement>(
      '.actions button.primary, .actions button.danger'
    );
    if (button && !button.disabled)
    {
      button.click();
    }
  }

  /**
   * Put the keyboard in the first field worth typing into, and nowhere else. Never a
   * button: focusing one draws a ring around it, and this app does not put rings on
   * controls. A dialog with no field loses no capability: Enter still presses the confirming button via the window's own handler below.
   */
  function firstControl(): HTMLElement | null
  {
    return (
      document
        .querySelector('.frame')
        ?.querySelector<HTMLElement>(
          '.body input:not([type="hidden"]):not([readonly]):not([disabled]), ' +
            '.body select:not([disabled]), .body textarea:not([disabled])'
        ) ?? null
    );
  }

  /**
   * Focus the first field, waiting for it to exist rather than assuming it already
   * does: an async dialog (`defineAsyncComponent` in `dialogs/routes.ts`) is still a
   * comment node at `ready`. Polls rather than a fixed `nextTick`, giving up after a
   * second (a dialog with no field is ordinary) or when the dialog itself closes first.
   */
  async function focusFirstControl(): Promise<void>
  {
    const deadline = Date.now() + 1000;
    for (;;)
    {
      if (!mounted)
      {
        return;
      }
      const control = firstControl();
      if (control)
      {
        control.focus();
        return;
      }
      if (Date.now() > deadline)
      {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  function onKeydown(event: KeyboardEvent): void
  {
    if (event.key === KEY_ESCAPE)
    {
      // A confirm raised by this dialog answers itself first; Escape a second time closes the window, or cancelling a question would close the dialog behind it.
      if (ui.confirmRequest)
      {
        ui.answerConfirm(false);
      }
      else
      {
        close();
      }
      return;
    }

    if (event.key !== KEY_ENTER || event.isComposing)
    {
      return;
    }

    const target = event.target as HTMLElement | null;
    // A multi-line box owns Enter: a commit or tag message is written in one.
    if (target?.tagName === TAG_TEXTAREA || target?.isContentEditable === true)
    {
      return;
    }
    // A button with the focus is pressed by Enter already; pressing another one would run the wrong action.
    if (target?.tagName === TAG_BUTTON)
    {
      return;
    }
    if (ui.confirmRequest)
    {
      return;
    }

    event.preventDefault();
    pressPrimary();
  }

  watch(ready, async (isReady) =>
  {
    if (!isReady)
    {
      return;
    }
    window.addEventListener('keydown', onKeydown);
    // After the dialog has rendered, the first moment it can have a control to focus; an async one takes several ticks more, which `focusFirstControl` waits out.
    await nextTick();
    void focusFirstControl();
  });

  onUnmounted(() =>
  {
    mounted = false;
    window.removeEventListener('keydown', onKeydown);
  });
}
