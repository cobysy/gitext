/**
 * File grouping by extension or git status: one function for both lists (rule duplication is a bug).
 * Pure logic; status wording comes from STATUS_TITLE.
 */

import { extensionOf } from '@renderer/filetree.js';
import { STATUS_TITLE } from '@renderer/model/fileRowDescription.js';
import type { DiffFileEntry } from '@shared/diff.js';

export const GROUP_VIEW_EXTENSION = 'extension' as const;
export const GROUP_VIEW_STATUS = 'status' as const;

/** The two shapes that are a grouping rather than a path tree. */
export type GroupView = typeof GROUP_VIEW_EXTENSION | typeof GROUP_VIEW_STATUS;

/** Whether a list view is one of the two groupings, narrowing it to `GroupView`. */
export function isGroupView(view: string): view is GroupView
{
  return view === GROUP_VIEW_EXTENSION || view === GROUP_VIEW_STATUS;
}

/** Entry with no status groups under "Changed" (same as unrecognized status). */
export function groupHeadingOf(entry: { path: string; status?: string }, view: GroupView): string
{
  if (view === GROUP_VIEW_EXTENSION)
  {
    return extensionOf(entry.path);
  }
  return STATUS_TITLE[(entry.status ?? 'unknown') as DiffFileEntry['status']] ?? STATUS_TITLE.unknown;
}
