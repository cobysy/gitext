/** Persisted section order: reconciling it against this build's sections, and reordering it. */

import { DEFAULT_SECTIONS, type PanelSectionId } from './types.js';

/**
 * Reconcile persisted section order with current build. All six always drawn (no hiding).
 * Settings merge over defaults: unknown IDs dropped, missing appended. Legacy format
 * with visibility flag handled (flag discarded).
 */
/** Check if id is known and not yet seen. */
function isNewKnownSection(
  id: unknown,
  known: ReadonlySet<string>,
  seen: ReadonlySet<PanelSectionId>
): id is PanelSectionId
{
  return typeof id === 'string' && known.has(id) && !seen.has(id as PanelSectionId);
}

export function normalizeSections(stored: unknown): PanelSectionId[]
{
  if (!Array.isArray(stored))
  {
    return [...DEFAULT_SECTIONS];
  }

  const known = new Set<string>(DEFAULT_SECTIONS);
  const seen = new Set<PanelSectionId>();
  const result: PanelSectionId[] = [];

  for (const entry of stored)
  {
    let id;
    if (typeof entry === 'string')
    {
      id = entry;
    }
    else
    {
      id = (entry as { id?: unknown } | null)?.id;
    }
    if (!isNewKnownSection(id, known, seen))
    {
      continue;
    }
    seen.add(id);
    result.push(id);
  }

  for (const id of DEFAULT_SECTIONS)
  {
    if (!seen.has(id))
    {
      result.push(id);
    }
  }

  return result;
}

/**
 * Move section up/down. Returns new array; out-of-range moves return input.
 */
export function moveSection(
  sections: readonly PanelSectionId[],
  id: PanelSectionId,
  direction: -1 | 1
): PanelSectionId[]
{
  const from = sections.indexOf(id);
  if (from === -1)
  {
    return [...sections];
  }

  const to = from + direction;
  if (to < 0 || to >= sections.length)
  {
    return [...sections];
  }

  const next = [...sections];
  const moved = next[from];
  const target = next[to];
  if (!moved || !target)
  {
    return next;
  }
  next[from] = target;
  next[to] = moved;
  return next;
}
