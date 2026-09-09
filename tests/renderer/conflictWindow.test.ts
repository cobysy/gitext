/**
 * When the conflict resolver has nothing left to be open for.
 *
 * Its own file because the rule has been wrong in both directions, and each direction has
 * a case that looks like the other one until it is written down.
 */

import { describe, expect, it } from 'vitest';
import { OPERATION_MERGE, OPERATION_NONE, OPERATION_REBASE } from '@shared/types.js';
import { nothingToResolve } from '@renderer/model/conflictWindow.js';

describe('nothingToResolve', () =>
{
  it('is true when the operation ended and nothing is conflicted', () =>
  {
    expect(nothingToResolve(OPERATION_NONE, 0)).toBe(true);
  });

  /**
   * `git stash pop` and a squashed merge leave conflicts with nothing in progress, and are
   * the reason this window can be opened outside an operation at all. Closing on the
   * operation alone shut it in exactly the case it was opened for.
   */
  it('is false for conflicts that belong to no operation', () =>
  {
    expect(nothingToResolve(OPERATION_NONE, 1)).toBe(false);
    expect(nothingToResolve(OPERATION_NONE, 12)).toBe(false);
  });

  /** Every file resolved but not yet committed: still a window with a Continue to offer. */
  it('is false while an operation is still in progress', () =>
  {
    expect(nothingToResolve(OPERATION_MERGE, 0)).toBe(false);
    expect(nothingToResolve(OPERATION_REBASE, 0)).toBe(false);
  });

  it('is false when both are there', () =>
  {
    expect(nothingToResolve(OPERATION_MERGE, 3)).toBe(false);
  });
});
