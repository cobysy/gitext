/**
 * When conflict resolver has nothing left. Tested: operation alone or
 * conflict alone can both be wrong separately. Pure, DOM-free.
 */

import { OPERATION_NONE, type InProgressOperation } from '@shared/types.js';

/**
 * True when neither conflict nor operation. Both terms matter separately:
 * conflict doesn't imply operation (stash pop, squash merge); operation doesn't
 * a window that still has a Continue to offer.
 *
 * So the window closes on the *pair* going empty: the abort typed in a terminal, or the
 * commit that finished the job, and on nothing else.
 */
export function nothingToResolve(operation: InProgressOperation, conflictCount: number): boolean
{
  return operation === OPERATION_NONE && conflictCount === 0;
}
