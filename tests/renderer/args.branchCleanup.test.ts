/**
 * `buildBranchDeleteSteps`: the argv the cleanup dialog previews and runs.
 *
 * The split between `-d` and `-D` is the safety property, not a formatting detail: a
 * branch git can check must still be checked by git. These pin that.
 */

import { describe, expect, it } from 'vitest';
import { buildBranchDeleteSteps } from '@renderer/model/args/branchCleanup.js';

describe('buildBranchDeleteSteps', () =>
{
  it('deletes nothing when nothing is selected', () =>
  {
    expect(buildBranchDeleteSteps({ safe: [], forced: [] })).toEqual([]);
  });

  it('uses -d for branches git can confirm are merged', () =>
  {
    expect(buildBranchDeleteSteps({ safe: ['a', 'b'], forced: [] })).toEqual([
      ['branch', '-d', 'a', 'b']
    ]);
  });

  it('uses -D only for the squash-merged ones', () =>
  {
    expect(buildBranchDeleteSteps({ safe: [], forced: ['x'] })).toEqual([
      ['branch', '-D', 'x']
    ]);
  });

  it('keeps the two apart rather than forcing the lot', () =>
  {
    // The whole point: a single `-D a b x` would be one command and would stop git
    // verifying `a` and `b` at the moment of deletion, for no gain.
    expect(buildBranchDeleteSteps({ safe: ['a', 'b'], forced: ['x'] })).toEqual([
      ['branch', '-d', 'a', 'b'],
      ['branch', '-D', 'x']
    ]);
  });

  it('puts the checked deletions first, so a failure there stops the forced ones', () =>
  {
    const [first] = buildBranchDeleteSteps({ safe: ['a'], forced: ['x'] });
    expect(first).toEqual(['branch', '-d', 'a']);
  });

  it('passes branch names through verbatim: no quoting, it is an argv', () =>
  {
    expect(buildBranchDeleteSteps({ safe: ["odd 'name'"], forced: [] })).toEqual([
      ['branch', '-d', "odd 'name'"]
    ]);
  });
});
