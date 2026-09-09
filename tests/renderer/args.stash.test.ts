/**
 * `git stash`: save, apply, pop and drop.
 *
 * The one rule worth pinning is the first case below.
 */

import { describe, expect, it } from 'vitest';
import {
  buildStashApplyArgs,
  buildStashDropArgs,
  buildStashSaveArgs,
  buildStashShowArgs
} from '@renderer/model/args/stash.js';

describe('buildStashSaveArgs', () =>
{
  it('always uses `push`, never the deprecated `save`', () =>
  {
    // `save` takes a bare message, so `git stash save -u` reads `-u` as the message on
    // older git. `push` takes `-m` in every case and is what git's own docs point at.
    expect(buildStashSaveArgs()).toEqual(['stash', 'push']);
    expect(buildStashSaveArgs({ message: 'wip' })).toEqual(['stash', 'push', '-m', 'wip']);
  });

  it('sweeps untracked files in with -u', () =>
  {
    expect(buildStashSaveArgs({ includeUntracked: true })).toEqual(['stash', 'push', '-u']);
  });

  it('keeps the staged half with --keep-index', () =>
  {
    expect(buildStashSaveArgs({ keepIndex: true })).toEqual([
      'stash',
      'push',
      '--keep-index'
    ]);
  });

  it('trims the message, so a field of spaces is no message at all', () =>
  {
    expect(buildStashSaveArgs({ message: '   ' })).toEqual(['stash', 'push']);
    expect(buildStashSaveArgs({ message: '  wip  ' })).toEqual(['stash', 'push', '-m', 'wip']);
  });

  it('takes paths after a --', () =>
  {
    expect(buildStashSaveArgs({ paths: ['a.txt', 'b.txt'] })).toEqual([
      'stash',
      'push',
      '--',
      'a.txt',
      'b.txt'
    ]);
  });

  it('omits the -- when there are no paths', () =>
  {
    // `git stash push --` with nothing after it stashes nothing at all, silently.
    expect(buildStashSaveArgs({ paths: [] })).not.toContain('--');
  });

  it('drops -u and --keep-index under --staged, which git rejects with them', () =>
  {
    // An untracked file is not staged, so the pair is contradictory; git refuses it.
    expect(
      buildStashSaveArgs({ stagedOnly: true, includeUntracked: true, keepIndex: true })
    ).toEqual(['stash', 'push', '--staged']);
  });

  it('keeps the message under --staged', () =>
  {
    expect(buildStashSaveArgs({ stagedOnly: true, message: 'wip' })).toEqual([
      'stash',
      'push',
      '--staged',
      '-m',
      'wip'
    ]);
  });

  it('never quotes: the argv is spawned, not shelled', () =>
  {
    expect(buildStashSaveArgs({ message: "a 'quoted' message" })).toEqual([
      'stash',
      'push',
      '-m',
      "a 'quoted' message"
    ]);
  });
});

describe('buildStashApplyArgs', () =>
{
  it('applies without dropping', () =>
  {
    expect(buildStashApplyArgs({ ref: 'stash@{0}' })).toEqual(['stash', 'apply', 'stash@{0}']);
  });

  it('pops, which is apply plus drop', () =>
  {
    expect(buildStashApplyArgs({ ref: 'stash@{1}', pop: true })).toEqual([
      'stash',
      'pop',
      'stash@{1}'
    ]);
  });

  it('restores the index only when asked', () =>
  {
    expect(buildStashApplyArgs({ ref: 'stash@{0}', restoreIndex: true })).toEqual([
      'stash',
      'apply',
      '--index',
      'stash@{0}'
    ]);
    expect(buildStashApplyArgs({ ref: 'stash@{0}' })).not.toContain('--index');
  });

  it('takes a SHA as readily as a selector', () =>
  {
    // `stash@{0}` moves when anything is dropped; the SHA does not, which is why the
    // dialog can hand over either.
    expect(buildStashApplyArgs({ ref: '4a2b1c9' })).toEqual(['stash', 'apply', '4a2b1c9']);
  });
});

describe('buildStashDropArgs', () =>
{
  it('drops one stash by name', () =>
  {
    expect(buildStashDropArgs('stash@{2}')).toEqual(['stash', 'drop', 'stash@{2}']);
  });
});

describe('buildStashShowArgs', () =>
{
  it('asks for the patch, which is what names the files', () =>
  {
    expect(buildStashShowArgs('stash@{0}')).toEqual(['stash', 'show', '-p', 'stash@{0}']);
  });

  it('can include the untracked files a -u stash carries', () =>
  {
    // Without it the pane lists two files for a stash holding three: the kind of wrong
    // that only shows up after you have popped it.
    expect(buildStashShowArgs('stash@{0}', true)).toEqual([
      'stash',
      'show',
      '-p',
      '--include-untracked',
      'stash@{0}'
    ]);
  });
});
