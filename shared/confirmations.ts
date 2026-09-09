/**
 * Suppressible confirmation dialogs: declared here so Settings always lists them with state.
 * "Don't ask again" with no escape is a trap; unsuppressed questions must be discoverable.
 */

import { isPlainRecord } from './record.js';

export interface ConfirmationEntry {
  key: string;
  /** What is being confirmed, as the Settings row reads it. */
  label: string;
  /** What answering yes forever actually does. */
  detail: string;
}

export const CONFIRMATIONS: readonly ConfirmationEntry[] = [
  {
    key: 'stash.drop',
    label: 'Dropping a stash',
    detail: 'A dropped stash is hard to recover.'
  },
  {
    key: 'branch.deleteUnmerged',
    label: 'Deleting an unmerged branch',
    detail: 'Its commits become unreachable.'
  },
  {
    key: 'branch.deleteRemote',
    label: 'Deleting a remote branch',
    detail: 'It happens on the server, for everyone.'
  },
  {
    key: 'checkout.reapplyStash',
    label: 'Re-applying the stash after a checkout',
    detail: 'Asked after a checkout stashed your changes.'
  },
  {
    key: 'pull.reapplyStash',
    label: 'Re-applying the stash after a pull',
    detail: 'Asked after a pull stashed your changes.'
  },
  {
    key: 'commit.undo',
    label: 'Undoing the last commit',
    detail: 'The commit goes; its changes stay.'
  },
  {
    key: 'push.force',
    label: 'Force-pushing without a lease',
    detail: 'Offers `--force-with-lease` instead.'
  },
  {
    key: 'push.setUpstream',
    label: 'Setting the tracking reference while pushing',
    detail: 'Asked when the branch has no upstream.'
  },
  {
    key: 'reset.discard',
    label: 'Discarding working-tree changes',
    detail: 'Uncommitted work `git has` never seen cannot be recovered.'
  }
] as const;

/** Normalize suppressions: keep unknown keys (questions may return), only true counts. */
export function normalizeSuppressions(value: unknown): Record<string, boolean>
{
  if (!isPlainRecord(value))
  {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value))
  {
    if (entry === true)
    {
      result[key] = true;
    }
  }
  return result;
}
