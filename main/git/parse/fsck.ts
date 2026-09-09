/**
 * `git fsck` output (newline-delimited, no `-z` mode). Fields are keywords or SHAs.
 * Prose like `error in tree` is dropped (damaged repo, not lost objects).
 */

import {
  OBJECT_KIND_BLOB,
  OBJECT_KIND_COMMIT,
  OBJECT_KIND_TAG,
  OBJECT_KIND_TREE,
  STATE_DANGLING,
  STATE_MISSING,
  STATE_UNREACHABLE,
  type LostObjectKind,
  type LostObjectState
} from '@shared/types.js';

const STATES = new Set<string>([STATE_DANGLING, STATE_UNREACHABLE, STATE_MISSING]);
const KINDS = new Set<string>([OBJECT_KIND_COMMIT, OBJECT_KIND_BLOB, OBJECT_KIND_TREE, OBJECT_KIND_TAG]);

/** SHA-1 (40 hex) or SHA-256 (64 hex) format. */
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** One line of fsck's report, before metadata lookup. */
export interface LostObjectRef {
  state: LostObjectState;
  kind: LostObjectKind;
  sha: string;
}

// Keep order from git; sorting is the dialog's decision (needs metadata).
/** True when state/kind/sha describe a lost object (not `error in tree` etc). */
function isLostObjectLine(state: string, kind: string, sha: string): boolean
{
  return STATES.has(state) && KINDS.has(kind) && SHA.test(sha);
}

export function parseFsck(output: string): LostObjectRef[]
{
  const found: LostObjectRef[] = [];

  for (const line of output.split('\n'))
  {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3)
    {
      continue;
    }

    const [state, kind, sha] = parts as [string, string, string];
    // Check all three: `error in tree <sha>` is also three tokens but not a lost object.
    if (!isLostObjectLine(state, kind, sha))
    {
      continue;
    }

    found.push({
      state: state as LostObjectState,
      kind: kind as LostObjectKind,
      sha
    });
  }

  return found;
}
