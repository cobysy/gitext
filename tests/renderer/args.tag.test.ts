/**
 * `git tag`, and the pushes that delete a ref on a remote.
 *
 * The two cases worth having are the separator and the message file: without `--`,
 * `git tag v1.0 main` is ambiguous the moment somebody has a branch called `v1.0`; and a
 * lightweight tag has nowhere to put a message, so a builder that emitted `-F` for one
 * would produce a command git rejects.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCreateTagArgs,
  buildDeleteRemoteRefArgs,
  buildDeleteTagArgs,
  TAG_KINDS
} from '@renderer/model/args/tag.js';
import {
  buildDeleteBranchArgs,
  buildRenameBranchArgs
} from '@renderer/model/args/branch.js';

describe('buildCreateTagArgs', () =>
{
  it('a lightweight tag is the bare command', () =>
  {
    expect(buildCreateTagArgs({ name: 'v1.0', commit: 'HEAD' })).toEqual([
      'tag',
      'v1.0',
      '--',
      'HEAD'
    ]);
  });

  it('separates the name from the commit with --', () =>
  {
    // Without it `git tag v1.0 main` is ambiguous the moment somebody has a branch called
    // `v1.0`.
    for (const entry of TAG_KINDS)
    {
      const argv = buildCreateTagArgs({ name: 'v1.0', commit: 'main', kind: entry.kind });
      expect(argv.at(-2)).toBe('--');
      expect(argv.at(-1)).toBe('main');
    }
  });

  it('annotated', () =>
  {
    expect(buildCreateTagArgs({ name: 'v1.0', commit: 'HEAD', kind: 'annotated' })).toEqual([
      'tag',
      '-a',
      'v1.0',
      '--',
      'HEAD'
    ]);
  });

  it('passes a message as -F and a path', () =>
  {
    expect(
      buildCreateTagArgs({
        name: 'v1.0',
        commit: 'HEAD',
        kind: 'annotated',
        messageFile: '/repo/.git/TAG_EDITMSG'
      })
    ).toEqual(['tag', '-a', '-F', '/repo/.git/TAG_EDITMSG', 'v1.0', '--', 'HEAD']);
  });

  it('never passes a message for a lightweight tag', () =>
  {
    // There is nowhere to put one: git rejects `-F` without `-a`, `-s` or `-u`.
    expect(
      buildCreateTagArgs({
        name: 'v1.0',
        commit: 'HEAD',
        kind: 'lightweight',
        messageFile: '/repo/.git/TAG_EDITMSG'
      })
    ).not.toContain('-F');
  });

  it('forces with -f', () =>
  {
    const argv = buildCreateTagArgs({ name: 'v1.0', commit: 'HEAD', force: true });
    expect(argv[1]).toBe('-f');
  });

  it('trims the name', () =>
  {
    expect(buildCreateTagArgs({ name: '  v1.0  ', commit: 'HEAD' })).toContain('v1.0');
  });
});

describe('buildDeleteTagArgs', () =>
{
  it('deletes one', () =>
  {
    expect(buildDeleteTagArgs(['v1.0'])).toEqual(['tag', '-d', 'v1.0']);
  });

  it('deletes several in one command', () =>
  {
    expect(buildDeleteTagArgs(['v1.0', 'v1.1'])).toEqual(['tag', '-d', 'v1.0', 'v1.1']);
  });

  it('builds nothing for an empty list', () =>
  {
    expect(buildDeleteTagArgs([])).toEqual([]);
  });
});

describe('buildDeleteRemoteRefArgs', () =>
{
  it('deletes a ref on the remote by pushing nothing to it', () =>
  {
    expect(buildDeleteRemoteRefArgs('origin', ['v1.0'])).toEqual([
      'push',
      'origin',
      '--delete',
      'v1.0'
    ]);
  });

  it('takes several at once', () =>
  {
    expect(buildDeleteRemoteRefArgs('origin', ['a', 'b'])).toEqual([
      'push',
      'origin',
      '--delete',
      'a',
      'b'
    ]);
  });

  it('builds nothing without a remote or without refs', () =>
  {
    expect(buildDeleteRemoteRefArgs('', ['v1.0'])).toEqual([]);
    expect(buildDeleteRemoteRefArgs('origin', [])).toEqual([]);
  });
});

describe('buildDeleteBranchArgs', () =>
{
  it('uses the long spellings, which is what makes a command log readable later', () =>
  {
    expect(buildDeleteBranchArgs(['feature'])).toEqual(['branch', '--delete', 'feature']);
  });

  it('forces with --force rather than -D', () =>
  {
    expect(buildDeleteBranchArgs(['feature'], true)).toEqual([
      'branch',
      '--delete',
      '--force',
      'feature'
    ]);
  });

  it('deletes several in one command', () =>
  {
    expect(buildDeleteBranchArgs(['a', 'b', 'c'])).toEqual([
      'branch',
      '--delete',
      'a',
      'b',
      'c'
    ]);
  });

  it('builds nothing for an empty list', () =>
  {
    expect(buildDeleteBranchArgs([])).toEqual([]);
  });
});

describe('buildRenameBranchArgs', () =>
{
  it('renames', () =>
  {
    expect(buildRenameBranchArgs('old', 'new')).toEqual(['branch', '-m', 'old', 'new']);
  });

  it('trims both', () =>
  {
    expect(buildRenameBranchArgs('  old  ', '  new  ')).toEqual([
      'branch',
      '-m',
      'old',
      'new'
    ]);
  });

  it('builds nothing when either is empty', () =>
  {
    expect(buildRenameBranchArgs('old', '   ')).toEqual([]);
    expect(buildRenameBranchArgs('', 'new')).toEqual([]);
  });
});
