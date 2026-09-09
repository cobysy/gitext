/**
 * Reading `graphDimNonRelatives` back off disk.
 *
 * It is a three-rung ladder now and was a pair of booleans before, and settings merge
 * shallowly with no migration step: so a config written by an older build arrives with
 * the pair and has to land on the rung that means the same thing. The one combination
 * with no rung, text grey while the lanes stay lit, is the reason the pair was collapsed,
 * so what it becomes is a decision worth pinning rather than an accident of the branches.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GRAPH_DIM_ALL,
  GRAPH_DIM_LANES,
  GRAPH_DIM_NONE,
  toGraphDimming
} from '@shared/types.js';

describe('reading a stored dimming value', () =>
{
  it('keeps a value already written as a rung', () =>
  {
    expect(toGraphDimming(GRAPH_DIM_NONE, undefined)).toBe(GRAPH_DIM_NONE);
    expect(toGraphDimming(GRAPH_DIM_LANES, undefined)).toBe(GRAPH_DIM_LANES);
    expect(toGraphDimming(GRAPH_DIM_ALL, undefined)).toBe(GRAPH_DIM_ALL);
  });

  it('reads the old pair of booleans as the rung that means the same', () =>
  {
    expect(toGraphDimming(true, false)).toBe(GRAPH_DIM_LANES);
    expect(toGraphDimming(true, true)).toBe(GRAPH_DIM_ALL);
    expect(toGraphDimming(false, false)).toBe(GRAPH_DIM_NONE);
  });

  it('reads the combination with no rung as dimming nothing', () =>
  {
    // Lanes off, text on: what a pair of booleans allowed and nobody chose. The lanes
    // being lit is the half that was visible, so that is the half the reading keeps.
    expect(toGraphDimming(false, true)).toBe(GRAPH_DIM_NONE);
  });

  it('falls back to the default for an absent or unrecognised value', () =>
  {
    // Absent is the ordinary case for a key a build has never written.
    expect(toGraphDimming(undefined, undefined)).toBe(DEFAULT_SETTINGS.graphDimNonRelatives);
    expect(toGraphDimming('lanes-and-something', undefined)).toBe(
      DEFAULT_SETTINGS.graphDimNonRelatives
    );
    expect(toGraphDimming(null, null)).toBe(DEFAULT_SETTINGS.graphDimNonRelatives);
  });

  it('ships dimming the lanes, which is what the pair defaulted to', () =>
  {
    expect(DEFAULT_SETTINGS.graphDimNonRelatives).toBe(GRAPH_DIM_LANES);
  });
});
