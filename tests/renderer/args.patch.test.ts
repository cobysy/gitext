/**
 * `git format-patch`, `git apply` and `git am` argv.
 *
 * The case worth pinning is the range: with no older end, `<from>..<to>` would be
 * `..<to>`, which git reads as "from HEAD" rather than "from the beginning". `--root
 * <to>` is the difference between exporting a branch and exporting nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  APPLY_MODES,
  buildApplyPatchArgs,
  buildApplyStepArgs,
  buildFormatPatchArgs
} from '@renderer/model/args/patch.js';

describe('buildFormatPatchArgs', () =>
{
  it('a range, written the way a person would type it', () =>
  {
    expect(
      buildFormatPatchArgs({ from: 'main', to: 'feature', output: '/tmp/patches' })
    ).toEqual([
      'format-patch',
      '--find-renames',
      '--find-copies',
      '--break-rewrites',
      'main..feature',
      '-o',
      '/tmp/patches'
    ]);
  });

  it('no older end is --root, not an empty range', () =>
  {
    // `..feature` means "from HEAD", which is not what "everything on this branch" means.
    const argv = buildFormatPatchArgs({ from: '', to: 'feature', output: '/tmp/p' });
    expect(argv).toContain('--root');
    expect(argv.join(' ')).not.toContain('..');
  });

  it('numbers from wherever it is told to', () =>
  {
    expect(
      buildFormatPatchArgs({ from: 'main', to: 'feature', output: '/tmp/p', startNumber: 4 })
    ).toContain('--start-number');
  });

  it('always asks for rename detection', () =>
  {
    // A patch describing a rename as a rename applies where one describing it as a delete
    // and an add conflicts.
    const argv = buildFormatPatchArgs({ from: 'a', to: 'b', output: '/tmp/p' });
    for (const flag of ['--find-renames', '--find-copies', '--break-rewrites'])
    {
      expect(argv).toContain(flag);
    }
  });

  it('is empty without a destination or a newer end', () =>
  {
    expect(buildFormatPatchArgs({ from: 'main', to: 'feature', output: '' })).toEqual([]);
    expect(buildFormatPatchArgs({ from: 'main', to: '', output: '/tmp/p' })).toEqual([]);
  });
});

describe('buildApplyPatchArgs', () =>
{
  it('git apply takes the changes and nothing else', () =>
  {
    expect(buildApplyPatchArgs({ file: '/tmp/a.patch' })).toEqual(['apply', '/tmp/a.patch']);
  });

  it('--index puts them in the index too', () =>
  {
    expect(buildApplyPatchArgs({ file: '/tmp/a.patch', index: true })).toEqual([
      'apply',
      '--index',
      '/tmp/a.patch'
    ]);
  });

  it('git am makes commits, three-way', () =>
  {
    expect(buildApplyPatchArgs({ mode: 'am', file: '/tmp/patches' })).toEqual([
      'am',
      '--3way',
      '/tmp/patches'
    ]);
  });

  it('both modes take --ignore-whitespace', () =>
  {
    for (const entry of APPLY_MODES)
    {
      expect(
        buildApplyPatchArgs({ mode: entry.mode, file: '/tmp/p', ignoreWhitespace: true })
      ).toContain('--ignore-whitespace');
    }
  });

  it('every mode in the table names the command it runs', () =>
  {
    for (const entry of APPLY_MODES)
    {
      expect(buildApplyPatchArgs({ mode: entry.mode, file: '/tmp/p' })[0]).toBe(entry.mode);
    }
  });

  it('is empty without a file', () =>
  {
    expect(buildApplyPatchArgs({ file: '  ' })).toEqual([]);
  });
});

describe('buildApplyStepArgs', () =>
{
  it('the three ways out of an am that stopped', () =>
  {
    expect(buildApplyStepArgs('continue')).toEqual(['am', '--continue']);
    expect(buildApplyStepArgs('skip')).toEqual(['am', '--skip']);
    expect(buildApplyStepArgs('abort')).toEqual(['am', '--abort']);
  });
});
