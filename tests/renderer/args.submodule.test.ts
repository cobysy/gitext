/**
 * `git submodule` argv.
 *
 * Two things are worth pinning. `update` defaults to `--init --recursive`, because
 * without `--init` it silently does nothing for a submodule that has never been checked
 * out, which is the one anybody is most likely to be updating. And removing a submodule
 * is two commands with a third thing git leaves behind, which the builder deliberately
 * does not do.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAddSubmoduleArgs,
  buildRemoveSubmoduleSteps,
  buildSubmoduleSummaryArgs,
  buildSyncSubmodulesArgs,
  buildUpdateSubmoduleArgs
} from '@renderer/model/args/submodule.js';

describe('buildAddSubmoduleArgs', () =>
{
  it('url then path, as git takes them', () =>
  {
    expect(
      buildAddSubmoduleArgs({ url: 'https://example.com/lib.git', path: 'vendor/lib' })
    ).toEqual(['submodule', 'add', 'https://example.com/lib.git', 'vendor/lib']);
  });

  it('tracks a branch when one is named', () =>
  {
    expect(
      buildAddSubmoduleArgs({ url: 'https://x/lib.git', path: 'lib', branch: 'main' })
    ).toEqual(['submodule', 'add', '-b', 'main', 'https://x/lib.git', 'lib']);
  });

  it('-f comes first', () =>
  {
    const argv = buildAddSubmoduleArgs({
      url: 'https://x/lib.git',
      path: 'lib',
      branch: 'main',
      force: true
    });
    expect(argv.indexOf('-f')).toBeLessThan(argv.indexOf('-b'));
  });

  it('writes the path with POSIX separators: .gitmodules is committed', () =>
  {
    expect(
      buildAddSubmoduleArgs({ url: 'https://x/lib.git', path: 'vendor\\lib' }).at(-1)
    ).toBe('vendor/lib');
  });

  it('is empty without both halves', () =>
  {
    expect(buildAddSubmoduleArgs({ url: '', path: 'lib' })).toEqual([]);
    expect(buildAddSubmoduleArgs({ url: 'https://x/lib.git', path: '  ' })).toEqual([]);
  });
});

describe('buildUpdateSubmoduleArgs', () =>
{
  it('initialises and recurses by default', () =>
  {
    // Without `--init`, updating a submodule nobody has checked out does nothing at all
    // and says nothing about it.
    expect(buildUpdateSubmoduleArgs()).toEqual([
      'submodule',
      'update',
      '--init',
      '--recursive'
    ]);
  });

  it('takes one submodule behind a --', () =>
  {
    expect(buildUpdateSubmoduleArgs({ path: 'vendor/lib' })).toEqual([
      'submodule',
      'update',
      '--init',
      '--recursive',
      '--',
      'vendor/lib'
    ]);
  });

  it('--remote takes the branch head rather than the recorded commit', () =>
  {
    expect(buildUpdateSubmoduleArgs({ remote: true })).toContain('--remote');
  });

  it('can be asked for neither flag', () =>
  {
    expect(buildUpdateSubmoduleArgs({ init: false, recursive: false })).toEqual([
      'submodule',
      'update'
    ]);
  });
});

describe('buildSyncSubmodulesArgs', () =>
{
  it('recurses by default', () =>
  {
    expect(buildSyncSubmodulesArgs()).toEqual(['submodule', 'sync', '--recursive']);
  });

  it('takes one submodule', () =>
  {
    expect(buildSyncSubmodulesArgs({ path: 'lib' })).toEqual([
      'submodule',
      'sync',
      '--recursive',
      '--',
      'lib'
    ]);
  });
});

describe('buildRemoveSubmoduleSteps', () =>
{
  it('is deinit then rm: git has no single command for it', () =>
  {
    expect(buildRemoveSubmoduleSteps('vendor/lib').map((step) => step.argv)).toEqual([
      ['submodule', 'deinit', '-f', '--', 'vendor/lib'],
      ['rm', '-f', '--', 'vendor/lib']
    ]);
  });

  it('does not touch .git/modules', () =>
  {
    // Deleting it is a filesystem operation with no argv, and a dialog that previews a
    // command must not quietly do something the preview does not describe.
    expect(buildRemoveSubmoduleSteps('lib').map((step) => step.argv.join(' ')).join()).not.toContain(
      'modules'
    );
  });

  it('is empty without a path', () =>
  {
    expect(buildRemoveSubmoduleSteps('  ')).toEqual([]);
  });
});

describe('buildSubmoduleSummaryArgs', () =>
{
  it('reads the index, not the working tree', () =>
  {
    // `--cached` is the whole point: the commit screen is describing the change about to
    // be committed, and without it git answers about the working tree instead.
    expect(buildSubmoduleSummaryArgs()).toEqual(['submodule', 'summary', '--cached']);
  });

  it('narrows to one submodule, behind the separator', () =>
  {
    expect(buildSubmoduleSummaryArgs('vendor/lib')).toEqual([
      'submodule',
      'summary',
      '--cached',
      '--',
      'vendor/lib'
    ]);
  });

  it('summarizes everything when the path is blank', () =>
  {
    expect(buildSubmoduleSummaryArgs('   ')).toEqual(['submodule', 'summary', '--cached']);
  });
});
