/**
 * Opening a URL in the user's browser, for the ones it is safe to hand over.
 *
 * A repository's remote URL is attacker-influenceable: cloning someone's repository is
 * enough to put a string of their choosing into `git config`, and the left panel offers
 * "Open Remote URL in Browser" for it. Handed straight to `shell.openExternal`, a
 * `file://` URL opens a local file and a custom scheme launches whatever application has
 * registered for it, with an argument the repository chose.
 *
 * Only `http` and `https` cross this boundary. Everything else is refused and reported,
 * because silently doing nothing looks like a broken menu row.
 */

import { shell } from 'electron';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Whether `url` is something this app is willing to hand to the browser. */
export function isBrowsableUrl(url: string): boolean
{
  let parsed: URL;
  try
  {
    parsed = new URL(url);
  }
  catch
  {
    // Not a URL at all: an SSH remote (`git@host:owner/name.git`) reaches here, and a
    // browser is not what it is for.
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

/**
 * Open `url` in the browser if it is safe to. Returns what happened, so a caller can say
 * so rather than leaving the user with a row that appears to do nothing.
 */
export async function openExternalSafely(url: string): Promise<{ opened: boolean; reason?: string }>
{
  if (!isBrowsableUrl(url))
  {
    return { opened: false, reason: 'Only http and https addresses open in a browser.' };
  }
  try
  {
    await shell.openExternal(url);
    return { opened: true };
  }
  catch (err)
  {
    let reason: string;
    if (err instanceof Error)
    {
      reason = err.message;
    }
    else
    {
      reason = String(err);
    }
    return { opened: false, reason };
  }
}
