import {
  SUBMODULE_STATE_CONFLICTED,
  SUBMODULE_STATE_CURRENT,
  SUBMODULE_STATE_DIFFERENT_COMMIT,
  SUBMODULE_STATE_UNINITIALIZED,
  type SubmoduleEntry,
  type SubmoduleStatusEntry
} from '@shared/types.js';
import { splitNul } from './common.js';

const FIELD_BRANCH = 'branch';

const MARK_UNINITIALIZED = '-';
const MARK_DIFFERENT_COMMIT = '+';
const MARK_CONFLICTED = 'U';

/**
 * Parse `git config -f .gitmodules --null --list`. git handles quoting.
 * Initialized check is caller's.
 */
export function parseSubmoduleConfig(text: string): Omit<SubmoduleEntry, 'initialized'>[]
{
  const byName = new Map<string, Omit<SubmoduleEntry, 'initialized'>>();

  for (const entry of splitNul(text))
  {
    const newline = entry.indexOf('\n');
    let key;
    if (newline === -1)
    {
      key = entry;
    }
    else
    {
      key = entry.slice(0, newline);
    }
    let value;
    if (newline === -1)
    {
      value = '';
    }
    else
    {
      value = entry.slice(newline + 1);
    }

    const match = /^submodule\.(.+)\.(path|url|branch)$/.exec(key);
    if (!match)
    {
      continue;
    }
    const [, name, field] = match as unknown as [string, string, 'path' | 'url' | 'branch'];

    const existing = byName.get(name) ?? { name, path: '', url: '', branch: null };
    if (field === FIELD_BRANCH)
    {
      existing.branch = value || null;
    }
    else
    {
      existing[field] = value;
    }
    byName.set(name, existing);
  }

  // No path: not a submodule git would act on.
  return [...byName.values()].filter((entry) => entry.path !== '');
}

/**
 * Parse `git submodule status` (shell script, no -z). Newline-split.
 * git quotes paths with awkward chars.
 */
export function parseSubmoduleStatus(text: string): SubmoduleStatusEntry[]
{
  const result: SubmoduleStatusEntry[] = [];

  for (const line of text.split('\n'))
  {
    if (line.length === 0)
    {
      continue;
    }
    const mark = line[0] ?? ' ';
    const rest = line.slice(1);
    const space = rest.indexOf(' ');
    if (space === -1)
    {
      continue;
    }

    const sha = rest.slice(0, space);
    const remainder = rest.slice(space + 1);
    // (describe) suffix is git's annotation.
    const described = /^(.*?)(?: \(([^)]*)\))?$/.exec(remainder);

    let state: SubmoduleStatusEntry['state'];
    switch (mark)
    {
      case MARK_UNINITIALIZED:
        state = SUBMODULE_STATE_UNINITIALIZED;
        break;
      case MARK_DIFFERENT_COMMIT:
        state = SUBMODULE_STATE_DIFFERENT_COMMIT;
        break;
      case MARK_CONFLICTED:
        state = SUBMODULE_STATE_CONFLICTED;
        break;
      default:
        state = SUBMODULE_STATE_CURRENT;
        break;
    }

    result.push({
      path: described?.[1] ?? remainder,
      sha,
      described: described?.[2] ?? '',
      state
    });
  }

  return result;
}
