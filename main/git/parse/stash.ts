import type { StashEntry } from '@shared/types.js';
import { splitNul } from './common.js';

const STASH_FORMAT_FIELDS = ['%gd', '%H', '%ct', '%gs'] as const;

export const STASH_FORMAT = STASH_FORMAT_FIELDS.join('%x00');

/**
 * Parse `git stash list -z --format=STASH_FORMAT`. Records are 4 fields (NUL-separated),
 * fixed-size so they handle multiline messages. Message format: "WIP on branch: sha subject"
 * or "On branch: message" if given.
 */
export function parseStashList(text: string): StashEntry[]
{
  const fields = splitNul(text);
  const entries: StashEntry[] = [];

  for (let i = 0; i + STASH_FORMAT_FIELDS.length <= fields.length; i += STASH_FORMAT_FIELDS.length)
  {
    const at = (n: number): string => fields[i + n] ?? '';
    const name = at(0);
    const message = at(3);
    // Parse branch from message: "WIP on branch:" or "On branch:" format.
    const branch = /^(?:WIP on|On) ([^:]+): /.exec(message);

    entries.push({
      index: Number(/stash@\{(\d+)\}/.exec(name)?.[1] ?? entries.length),
      name,
      sha: at(1),
      date: Number(at(2)) || 0,
      message,
      branch: branch?.[1] ?? null
    });
  }

  return entries;
}
