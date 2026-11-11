/**
 * What the branch manager says about a row, and which picks a delete may be given.
 */

import { describe, expect, it } from 'vitest';
import { branchStates, deletable, mergedNames } from '@renderer/model/branchManager.js';
import { REF_KIND_BRANCH, type RefEntry } from '@shared/types.js';

function branch(name: string, extra: Partial<RefEntry> = {}): RefEntry
{
  return {
    fullName: `refs/heads/${name}`,
    name,
    kind: REF_KIND_BRANCH,
    sha: '0123456789abcdef0123456789abcdef01234567',
    date: 0,
    isCurrent: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    remote: null,
    isAnnotated: false,
    ...extra
  };
}

describe('branchStates', () =>
{
  it('says nothing about a merged branch level with its upstream', () =>
  {
    expect(branchStates(branch('feature', { upstream: 'origin/feature' }), true)).toEqual([]);
  });

  it('reads out where you are, the distance, and lost work, in that order', () =>
  {
    const entry = branch('feature', { upstreamGone: true, ahead: 2, behind: 1 });
    expect(branchStates(entry, false)).toEqual([
      'upstream gone',
      '2 ahead',
      '1 behind',
      'not merged'
    ]);
  });

  it('never calls the checked-out branch unmerged', () =>
  {
    expect(branchStates(branch('main', { isCurrent: true }), false)).toEqual(['you are here']);
  });
});

describe('deletable', () =>
{
  it('leaves out the checked-out branch', () =>
  {
    const picks = [branch('main', { isCurrent: true }), branch('a'), branch('b')];
    expect(deletable(picks).map((entry) => entry.name)).toEqual(['a', 'b']);
  });
});

describe('mergedNames', () =>
{
  it('is every merged branch but the checked-out one, in list order', () =>
  {
    const merged = new Set(['main', 'b', 'c']);
    const branches = [branch('main', { isCurrent: true }), branch('a'), branch('b'), branch('c')];
    expect(mergedNames(branches, (entry) => merged.has(entry.name))).toEqual(['b', 'c']);
  });
});
