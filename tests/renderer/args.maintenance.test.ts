/**
 * The `gc` and `prune` argv tables.
 *
 * Same reason every other builder here has a table test: the array is both what the dialog
 * previews and what actually runs, so a wrong flag is a wrong promise as well as a wrong
 * command. Both of these are irreversible: `gc --prune=now` and `prune` delete objects
 * nothing else holds a copy of, which makes "the preview said one thing and git did
 * another" the worst failure available.
 *
 * `buildFsckArgs` is not here: it lives in `shared/fsck.ts`, so its table is
 * `tests/shared/fsck.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildGcArgs, buildPruneArgs } from '@renderer/model/args/maintenance.js';

describe('buildGcArgs', () =>
{
  it('is bare on the common case', () =>
  {
    expect(buildGcArgs()).toEqual(['gc']);
    expect(buildGcArgs({})).toEqual(['gc']);
  });

  it('adds --aggressive', () =>
  {
    expect(buildGcArgs({ aggressive: true })).toEqual(['gc', '--aggressive']);
  });

  it('spells the prune cutoff as one argument', () =>
  {
    expect(buildGcArgs({ prune: 'now' })).toEqual(['gc', '--prune=now']);
    expect(buildGcArgs({ prune: '2.weeks.ago' })).toEqual(['gc', '--prune=2.weeks.ago']);
  });

  it('ignores a blank cutoff rather than emitting --prune=', () =>
  {
    // `git gc --prune=` is an error, and an empty text field is the ordinary state of one.
    expect(buildGcArgs({ prune: '' })).toEqual(['gc']);
    expect(buildGcArgs({ prune: '   ' })).toEqual(['gc']);
  });

  it('combines both, aggressive first', () =>
  {
    expect(buildGcArgs({ aggressive: true, prune: 'now' })).toEqual([
      'gc',
      '--aggressive',
      '--prune=now'
    ]);
  });
});

describe('buildPruneArgs', () =>
{
  it('is verbose, because the list of what it deleted is its whole output', () =>
  {
    expect(buildPruneArgs()).toEqual(['prune', '--verbose', '--progress']);
  });
});
