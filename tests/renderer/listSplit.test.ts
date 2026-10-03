/**
 * The commit screen's two lists, sharing one column.
 */

import { describe, expect, it } from 'vitest';
import { stagedHeight } from '@renderer/model/listSplit.js';

const MIN = 80;

describe('stagedHeight', () =>
{
  it('shares spare room evenly when both lists fit', () =>
  {
    // 400 spare: each list gets 200 of it.
    expect(stagedHeight({ available: 1000, staged: 200, unstaged: 400, min: MIN })).toBe(400);
  });

  it('shows a short staged list whole beside a long unstaged one', () =>
  {
    expect(stagedHeight({ available: 1000, staged: 150, unstaged: 3000, min: MIN })).toBe(150);
  });

  it('shows a short unstaged list whole beside a long staged one', () =>
  {
    expect(stagedHeight({ available: 1000, staged: 3000, unstaged: 150, min: MIN })).toBe(850);
  });

  it('splits down the middle when neither fits in half', () =>
  {
    expect(stagedHeight({ available: 1000, staged: 900, unstaged: 3000, min: MIN })).toBe(500);
  });

  it('never squeezes either list below the minimum', () =>
  {
    expect(stagedHeight({ available: 1000, staged: 10, unstaged: 3000, min: MIN })).toBe(MIN);
    expect(stagedHeight({ available: 1000, staged: 3000, unstaged: 10, min: MIN })).toBe(1000 - MIN);
  });
});
