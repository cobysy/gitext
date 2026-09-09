/**
 * `git cherry-pick` and `git revert` argv.
 *
 * The case worth having is `-m`: a merge commit has more than one parent, so "the changes
 * this commit introduced" is undefined until one is named, and git refuses the command
 * rather than guessing. Both builders emit it after `--no-commit` and before the
 * revision, because a flag order that drifts is a preview that stops matching the argv it
 * claims to describe.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCherryPickArgs,
  buildCherryPickStepArgs
} from '@renderer/model/args/cherrypick.js';
import { buildRevertArgs, buildRevertStepArgs } from '@renderer/model/args/revert.js';

describe('buildCherryPickArgs', () =>
{
  it('the plain case commits', () =>
  {
    expect(buildCherryPickArgs({ sha: 'abc123' })).toEqual(['cherry-pick', 'abc123']);
  });

  it('--no-commit when the commit is left to you', () =>
  {
    expect(buildCherryPickArgs({ sha: 'abc123', autoCommit: false })).toEqual([
      'cherry-pick',
      '--no-commit',
      'abc123'
    ]);
  });

  it('-x adds the reference to the message', () =>
  {
    expect(buildCherryPickArgs({ sha: 'abc123', addReference: true })).toEqual([
      'cherry-pick',
      '-x',
      'abc123'
    ]);
  });

  it('-m names the mainline parent of a merge', () =>
  {
    expect(buildCherryPickArgs({ sha: 'abc123', mainline: 2 })).toEqual([
      'cherry-pick',
      '-m',
      '2',
      'abc123'
    ]);
  });

  it('keeps the flag order', () =>
  {
    // `--no-commit`, then `-m <n>`, then `-x`, then the commit. Same array, same order,
    // in the preview and in the run.
    expect(
      buildCherryPickArgs({
        sha: 'abc123',
        autoCommit: false,
        addReference: true,
        mainline: 1
      })
    ).toEqual(['cherry-pick', '--no-commit', '-m', '1', '-x', 'abc123']);
  });

  it('no mainline is no -m, whether it is null or zero', () =>
  {
    for (const mainline of [null, 0, undefined])
    {
      expect(buildCherryPickArgs({ sha: 'abc123', mainline })).not.toContain('-m');
    }
  });

  it('is empty with nothing to pick, so the run is refused rather than bare', () =>
  {
    expect(buildCherryPickArgs({ sha: '' })).toEqual([]);
    expect(buildCherryPickArgs({ sha: '   ' })).toEqual([]);
  });

  it('trims the revision', () =>
  {
    expect(buildCherryPickArgs({ sha: '  abc123  ' })).toEqual(['cherry-pick', 'abc123']);
  });

  it('the four ways out of one that stopped', () =>
  {
    expect(buildCherryPickStepArgs('continue')).toEqual(['cherry-pick', '--continue']);
    expect(buildCherryPickStepArgs('skip')).toEqual(['cherry-pick', '--skip']);
    expect(buildCherryPickStepArgs('abort')).toEqual(['cherry-pick', '--abort']);
    expect(buildCherryPickStepArgs('quit')).toEqual(['cherry-pick', '--quit']);
  });
});

describe('buildRevertArgs', () =>
{
  it('the plain case commits', () =>
  {
    expect(buildRevertArgs({ sha: 'abc123' })).toEqual(['revert', 'abc123']);
  });

  it('--no-commit stages the undo and stops', () =>
  {
    expect(buildRevertArgs({ sha: 'abc123', autoCommit: false })).toEqual([
      'revert',
      '--no-commit',
      'abc123'
    ]);
  });

  it('-m names the parent the merge is reverted against', () =>
  {
    expect(buildRevertArgs({ sha: 'abc123', autoCommit: false, mainline: 1 })).toEqual([
      'revert',
      '--no-commit',
      '-m',
      '1',
      'abc123'
    ]);
  });

  it('has no -x: a revert records no reference', () =>
  {
    // `git revert` writes "This reverts commit …" into the message itself, so there is
    // nothing for `-x` to add and git does not accept it here.
    expect(buildRevertArgs({ sha: 'abc123', mainline: 2 })).not.toContain('-x');
  });

  it('is empty with nothing to revert', () =>
  {
    expect(buildRevertArgs({ sha: '' })).toEqual([]);
  });

  it('the four ways out of one that stopped', () =>
  {
    expect(buildRevertStepArgs('continue')).toEqual(['revert', '--continue']);
    expect(buildRevertStepArgs('abort')).toEqual(['revert', '--abort']);
  });
});
