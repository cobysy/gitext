/**
 * Copy to clipboard with a toast. One helper so failures are visible, not silent
 * until paste.
 */

import { toMessage } from '@renderer/api.js';
import { TOAST_TONE_ERROR, useUiStore } from '@renderer/stores/ui.js';


/**
 * `what` names what was copied (for the toast: "Copied SHA").
 *
 * Pass `null` for a caller that confirms success itself, the way the command preview and
 * the log panel do with a tick on the button. The failure toast is not optional: a copy
 * that silently did nothing is only discovered at the paste, somewhere else entirely.
 *
 * Returns whether it worked, so a caller showing its own tick knows not to.
 */
export async function copyText(text: string, what: string | null): Promise<boolean>
{
  const ui = useUiStore();
  try
  {
    await navigator.clipboard.writeText(text);
    if (what !== null)
    {
      ui.toast(`Copied ${what}`);
    }
    return true;
  }
  catch (err)
  {
    ui.toast(toMessage(err), TOAST_TONE_ERROR);
    return false;
  }
}
