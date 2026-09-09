/**
 * Conflict block colored stretches: pure, Monaco-free arithmetic (editor turns them to decorations).
 * Markers are their own kind: scaffolding git wrote, means "remove", not part of either side.
 */

import type { ConflictBlock } from './conflictMarkers.js';

export type ConflictRegionKind = 'marker' | 'ours' | 'base' | 'theirs';

/** A run of lines, 1-based and inclusive at both ends: Monaco's own numbering. */
export interface ConflictRegion {
  kind: ConflictRegionKind;
  startLine: number;
  endLine: number;
}

/**
 * Every coloured stretch in `blocks`, in file order.
 *
 * A side with no lines at all, one branch deleted what the other changed, contributes
 * nothing rather than a zero-height region, so the two markers simply meet.
 */
export function conflictRegions(blocks: readonly ConflictBlock[]): ConflictRegion[]
{
  const regions: ConflictRegion[] = [];

  const push = (kind: ConflictRegionKind, startLine: number, endLine: number): void =>
  {
    if (endLine >= startLine)
    {
      regions.push({ kind, startLine, endLine });
    }
  };

  for (const block of blocks)
  {
    push('marker', block.startLine, block.startLine);
    // Ours ends where the ancestor section opens under diff3 style, and at `=======`
    // otherwise: the two markers are alternatives, never both.
    push('ours', block.startLine + 1, (block.baseMarkerLine ?? block.midLine) - 1);
    if (block.baseMarkerLine !== null)
    {
      push('marker', block.baseMarkerLine, block.baseMarkerLine);
      push('base', block.baseMarkerLine + 1, block.midLine - 1);
    }
    push('marker', block.midLine, block.midLine);
    push('theirs', block.midLine + 1, block.endLine - 1);
    push('marker', block.endLine, block.endLine);
  }

  return regions;
}
