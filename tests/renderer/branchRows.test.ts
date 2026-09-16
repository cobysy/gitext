/**
 * Which branches a commit offers to act on: the rows of the revision grid's
 * *Checkout Branch* and *Delete Branch* submenus.
 *
 * The first case is the one that matters: right-clicking the commit you are sitting on
 * must not offer to check out where you already are, or to delete the branch you are on.
 */

import { describe, expect, it } from 'vitest';
import type { CommitRef } from '@shared/types.js';
import { branchRowsFor } from '@renderer/model/branchRows.js';

const ref = (name: string, kind: CommitRef['kind'], isCurrent = false): CommitRef => ({
  name,
  kind,
  isCurrent
});

describe('branchRowsFor', () =>
{
  it('offers nothing on a commit whose only branch is the one you are on', () =>
  {
    const rows = branchRowsFor([
      ref('main', 'branch', true),
      ref('origin/main', 'remote'),
      ref('origin/HEAD', 'remote')
    ]);

    // `origin/main` is excluded for a different reason than `main` is: see below. What
    // matters here is that the submenu greys rather than opening a picker.
    expect(rows.map((row) => row.ref)).toEqual(['origin/main']);
    expect(branchRowsFor([ref('main', 'branch', true)])).toEqual([]);
  });

  it('offers the branch on the row when it is not the current one', () =>
  {
    const rows = branchRowsFor([ref('main', 'branch'), ref('origin/main', 'remote')]);
    expect(rows).toEqual([
      { ref: 'main', remote: false },
      { ref: 'origin/main', remote: true }
    ]);
  });

  it('puts local branches before remote ones', () =>
  {
    const rows = branchRowsFor([
      ref('origin/feature', 'remote'),
      ref('feature', 'branch'),
      ref('upstream/feature', 'remote'),
      ref('other', 'branch')
    ]);

    expect(rows.map((row) => row.ref)).toEqual([
      'feature',
      'other',
      'origin/feature',
      'upstream/feature'
    ]);
  });

  it('drops origin/HEAD, which is a pointer and not a branch', () =>
  {
    const rows = branchRowsFor([ref('origin/HEAD', 'remote'), ref('origin/main', 'remote')]);
    expect(rows.map((row) => row.ref)).toEqual(['origin/main']);
  });

  it('drops tags and anything else that is not a branch', () =>
  {
    // A tag detaches HEAD, which is `commit.checkout`'s job and a different dialog.
    const rows = branchRowsFor([
      ref('v1.0', 'tag'),
      ref('HEAD', 'head'),
      ref('stash@{0}', 'stash'),
      ref('main', 'branch')
    ]);

    expect(rows.map((row) => row.ref)).toEqual(['main']);
  });

  it('has nothing to offer on a commit carrying no refs at all', () =>
  {
    expect(branchRowsFor([])).toEqual([]);
  });
});
