import type { RemoteEntry } from '@shared/types.js';
import { splitNul } from './common.js';

const FIELD_URL = 'url';
const DISABLED_REMOTE_MARKER = '-';

/**
 * Parse `git config --null --get-regexp '^-?remote\..*\.(url|pushurl)$'`.
 * Reads both enabled and disabled (renamed to `-remote.*`) sections: the panel needs to show
 * a deactivated remote so it can be re-enabled, but git does not list it.
 */
export function parseRemotes(text: string): RemoteEntry[]
{
  const byName = new Map<string, RemoteEntry>();

  for (const entry of splitNul(text))
  {
    const newline = entry.indexOf('\n');
    if (newline === -1)
    {
      continue;
    }
    const key = entry.slice(0, newline);
    const value = entry.slice(newline + 1);

    const match = /^(-?)remote\.(.+)\.(url|pushurl)$/.exec(key);
    if (!match)
    {
      continue;
    }
    const [, dash, name, field] = match as unknown as [
      string,
      string,
      string,
      'url' | 'pushurl'
    ];
    const disabled = dash === DISABLED_REMOTE_MARKER;

    const existing = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '', disabled };
    // A remote can have several URLs configured; git fetches from the first, so the
    // first is what the panel shows.
    if (field === FIELD_URL)
    {
      existing.fetchUrl ||= value;
    }
    else
    {
      existing.pushUrl ||= value;
    }
    // An enabled section wins if both spellings somehow exist: git obeys the enabled one,
    // so that is the truth about what this remote currently does.
    if (!disabled)
    {
      existing.disabled = false;
    }
    byName.set(name, existing);
  }

  // git defaults the push URL to the fetch URL, and so does the display.
  for (const remote of byName.values())
  {
    remote.pushUrl ||= remote.fetchUrl;
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
