/**
 * `comparisonOptions` and `defaultComparison`: what the branch cleanup compares against.
 */

import { describe, expect, it } from 'vitest';
import { comparisonOptions, defaultComparison } from '@renderer/model/cleanupComparison.js';
import type { RefEntry } from '@shared/types.js';

function ref(name: string, kind: RefEntry['kind'], extra: Partial<RefEntry> = {}): RefEntry
{
  let remote: string | null = null;
  if (kind === 'remote')
  {
    remote = name.slice(0, name.indexOf('/'));
  }
  return {
    fullName: `refs/${kind}/${name}`,
    name,
    kind,
    sha: '0'.repeat(40),
    date: 0,
    isCurrent: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    remote,
    isAnnotated: false,
    ...extra
  };
}

describe('comparisonOptions', () =>
{
  it('lists local branches, then remote-tracking ones, and never a tag', () =>
  {
    const refs = [ref('origin/main', 'remote'), ref('v1', 'tag'), ref('main', 'branch')];
    expect(comparisonOptions(refs).map((o) => o.value)).toEqual(['main', 'origin/main']);
  });
});

describe('defaultComparison', () =>
{
  it('opens on the remote copy of main, where server-side merges land', () =>
  {
    const refs = [ref('main', 'branch'), ref('origin/main', 'remote')];
    expect(defaultComparison(refs)).toBe('origin/main');
  });

  it("prefers the local branch's own upstream to origin", () =>
  {
    const refs = [
      ref('main', 'branch', { upstream: 'upstream/main' }),
      ref('origin/main', 'remote'),
      ref('upstream/main', 'remote')
    ];
    expect(defaultComparison(refs)).toBe('upstream/main');
  });

  it('takes any remote when origin has no copy', () =>
  {
    const refs = [ref('main', 'branch'), ref('fork/main', 'remote')];
    expect(defaultComparison(refs)).toBe('fork/main');
  });

  it('falls back to the local branch without a remote', () =>
  {
    expect(defaultComparison([ref('feature', 'branch'), ref('master', 'branch')])).toBe('master');
  });

  it('falls back to the current branch when no usual name exists', () =>
  {
    const refs = [ref('a', 'branch'), ref('b', 'branch', { isCurrent: true })];
    expect(defaultComparison(refs)).toBe('b');
  });
});
