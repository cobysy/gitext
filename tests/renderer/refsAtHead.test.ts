/**
 * The current-branch marker on a row's chips, re-decided against the branch checked out
 * now. The bug it exists for: a checkout does not reload the grid's rows, so the chip
 * parsed out of `HEAD -> ` kept filling in the branch that had been left.
 */

import { describe, expect, it } from 'vitest';
import { refsAtHead } from '@renderer/model/refsAtHead.js';
import type { CommitRef } from '@shared/types.js';

function ref(name: string, kind: CommitRef['kind'], isCurrent = false): CommitRef
{
  return { name, kind, isCurrent };
}

describe('refsAtHead', () =>
{
  it('marks the branch that is checked out now', () =>
  {
    const refs = refsAtHead([ref('master', 'branch'), ref('master2', 'branch', true)], 'master');
    expect(refs.map((r) => [r.name, r.isCurrent])).toEqual([
      ['master', true],
      ['master2', false]
    ]);
  });

  it('leaves the row alone when the log was already right', () =>
  {
    const refs = refsAtHead([ref('main', 'branch', true)], 'main');
    expect(refs).toEqual([ref('main', 'branch', true)]);
  });

  it('marks nothing when HEAD is on a branch this row does not carry', () =>
  {
    const refs = refsAtHead([ref('main', 'branch', true), ref('v1', 'tag')], 'feature');
    expect(refs.some((r) => r.isCurrent)).toBe(false);
  });

  it('never marks a tag or a remote-tracking branch, whatever they are named', () =>
  {
    const refs = refsAtHead([ref('main', 'tag'), ref('origin/main', 'remote')], 'main');
    expect(refs.some((r) => r.isCurrent)).toBe(false);
  });

  it('keeps the bare HEAD chip marked while HEAD is detached', () =>
  {
    const refs = refsAtHead([ref('HEAD', 'head', true), ref('v1', 'tag')], null);
    expect(refs.map((r) => [r.name, r.isCurrent])).toEqual([
      ['HEAD', true],
      ['v1', false]
    ]);
  });

  it('drops the bare HEAD chip once a branch is checked out', () =>
  {
    const refs = refsAtHead([ref('HEAD', 'head', true), ref('v1', 'tag')], 'main');
    expect(refs.map((r) => r.name)).toEqual(['v1']);
  });

  it('does not mutate the refs it was given', () =>
  {
    const original = ref('master2', 'branch', true);
    refsAtHead([original], 'master');
    expect(original.isCurrent).toBe(true);
  });
});
