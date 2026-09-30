/**
 * The commit screen's argv: the commit, and what runs before it under Commit All and
 * Commit All to New Branch. The order is the claim: a branch name git refuses has to
 * stop the run before the index is touched.
 */

import { describe, expect, it } from 'vitest';
import { buildCommitArgv, buildCommitSteps, type CommitOptions } from '@renderer/model/args/commit.js';

const PLAIN: CommitOptions = {
  message: 'Fix the thing',
  amend: false,
  resetAuthor: false,
  author: '',
  noVerify: false,
  finishingOperation: false
};

describe('buildCommitArgv', () =>
{
  it('passes the message as one argument, trimmed', () =>
  {
    expect(buildCommitArgv({ ...PLAIN, message: '  a "quoted" $message\n\nbody  ' })).toEqual([
      'commit',
      '-m',
      'a "quoted" $message\n\nbody'
    ]);
  });

  it('takes git prepared message when there is none', () =>
  {
    expect(buildCommitArgv({ ...PLAIN, message: '', amend: true })).toEqual(['commit', '--amend', '--no-edit']);
  });
});

describe('buildCommitSteps', () =>
{
  it('is the commit alone by default', () =>
  {
    expect(buildCommitSteps(PLAIN, { all: false, newBranch: '' }).map((s) => s.argv)).toEqual([
      ['commit', '-m', 'Fix the thing']
    ]);
  });

  it('stages everything, untracked included, before Commit All', () =>
  {
    expect(buildCommitSteps(PLAIN, { all: true, newBranch: '' }).map((s) => s.argv)).toEqual([
      ['add', '-A'],
      ['commit', '-m', 'Fix the thing']
    ]);
  });

  it('creates the branch first, then stages, then commits', () =>
  {
    expect(buildCommitSteps(PLAIN, { all: true, newBranch: ' feature/x ' }).map((s) => s.argv)).toEqual([
      ['switch', '-c', 'feature/x'],
      ['add', '-A'],
      ['commit', '-m', 'Fix the thing']
    ]);
  });
});
