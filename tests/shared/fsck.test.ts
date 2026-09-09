/**
 * The `git fsck` argv table.
 *
 * In `tests/shared/` because the builder is: `shared/fsck.ts`, alongside `shared/grep.ts`,
 * for the same reason: the listing read goes through a typed channel and a typed channel
 * builds its argv in main, while the dialog previews the same array. Both sides consume
 * this, so both sides depend on the flags being right.
 */

import { describe, expect, it } from 'vitest';
import { buildFsckArgs } from '@shared/fsck.js';

describe('buildFsckArgs', () =>
{
  it('suppresses the progress meter even with nothing else set', () =>
  {
    // Not cosmetic: the meter goes to stderr, and the listing read parses what fsck says.
    expect(buildFsckArgs()).toEqual(['fsck', '--no-progress']);
  });

  it('adds each option in a fixed order', () =>
  {
    expect(buildFsckArgs({ unreachable: true })).toEqual([
      'fsck',
      '--no-progress',
      '--unreachable'
    ]);
    expect(buildFsckArgs({ full: true })).toEqual(['fsck', '--no-progress', '--full']);
    expect(buildFsckArgs({ noReflogs: true })).toEqual([
      'fsck',
      '--no-progress',
      '--no-reflogs'
    ]);
  });

  it('carries --lost-found, which is the recovery half of the same command', () =>
  {
    expect(buildFsckArgs({ unreachable: true, lostFound: true })).toEqual([
      'fsck',
      '--no-progress',
      '--unreachable',
      '--lost-found'
    ]);
  });

  it('takes all four at once', () =>
  {
    expect(
      buildFsckArgs({ unreachable: true, full: true, noReflogs: true, lostFound: true })
    ).toEqual([
      'fsck',
      '--no-progress',
      '--unreachable',
      '--full',
      '--no-reflogs',
      '--lost-found'
    ]);
  });
});
