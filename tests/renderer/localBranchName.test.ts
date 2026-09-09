/**
 * What local branch a remote branch becomes.
 *
 * Three things ride on this: the name the reset radio offers, whether that radio says
 * "reset" or "create", and what the custom-name field is pre-filled with. Held to a
 * table so all three stay correct together.
 */

import { describe, expect, it } from 'vitest';
import {
  localTrackingBranchName,
  splitRemoteBranch,
  suggestedBranchNameAt,
  suggestedLocalBranchName,
  type RefAtRevision
} from '@renderer/model/localBranchName.js';

describe('splitRemoteBranch', () =>
{
  it('splits on the remote it belongs to', () =>
  {
    expect(splitRemoteBranch('origin/main', ['origin'])).toEqual({
      remote: 'origin',
      branch: 'main'
    });
  });

  it('keeps the slashes inside a branch name', () =>
  {
    expect(splitRemoteBranch('origin/feature/x', ['origin'])).toEqual({
      remote: 'origin',
      branch: 'feature/x'
    });
  });

  it('prefers the longest remote that claims it', () =>
  {
    // `origin/feature` is a legal remote name, and `origin/feature/x` is then ambiguous.
    // Splitting on the first slash would silently pick the wrong one.
    expect(splitRemoteBranch('origin/feature/x', ['origin', 'origin/feature'])).toEqual({
      remote: 'origin/feature',
      branch: 'x'
    });
  });

  it('is null when no remote claims it', () =>
  {
    expect(splitRemoteBranch('feature/x', ['origin'])).toBeNull();
  });

  it('does not treat a remote name as a branch of itself', () =>
  {
    expect(splitRemoteBranch('origin', ['origin'])).toBeNull();
  });
});

describe('localTrackingBranchName', () =>
{
  const remotes = ['origin'];

  it('is the branch whose upstream is this remote branch', () =>
  {
    const locals = [
      { name: 'main', upstream: 'origin/main' },
      { name: 'work', upstream: 'origin/feature' }
    ];
    expect(localTrackingBranchName('origin/feature', remotes, locals)).toBe('work');
  });

  it('prefers the upstream over a branch that merely shares the name', () =>
  {
    // The name is a convention; the upstream is a fact, and the fact wins.
    const locals = [
      { name: 'feature', upstream: null },
      { name: 'work', upstream: 'origin/feature' }
    ];
    expect(localTrackingBranchName('origin/feature', remotes, locals)).toBe('work');
  });

  it('falls back to the name inside the remote when nothing tracks it', () =>
  {
    expect(localTrackingBranchName('origin/feature/x', remotes, [])).toBe('feature/x');
  });

  it('leaves a ref no remote claims alone', () =>
  {
    expect(localTrackingBranchName('feature', remotes, [])).toBe('feature');
  });
});

describe('suggestedLocalBranchName', () =>
{
  const remotes = ['origin'];

  it('is <remote>_<branch>: a name that cannot collide with the tracking one', () =>
  {
    expect(suggestedLocalBranchName('origin/feature', remotes, [])).toBe('origin_feature');
  });

  it('keeps the slashes of a nested branch name', () =>
  {
    expect(suggestedLocalBranchName('origin/feature/x', remotes, [])).toBe(
      'origin_feature/x'
    );
  });

  it('counts up past a name that is taken', () =>
  {
    expect(suggestedLocalBranchName('origin/feature', remotes, ['origin_feature'])).toBe(
      'origin_feature_2'
    );
  });

  it('keeps counting past a run of them', () =>
  {
    expect(
      suggestedLocalBranchName('origin/feature', remotes, [
        'origin_feature',
        'origin_feature_2',
        'origin_feature_3'
      ])
    ).toBe('origin_feature_4');
  });

  it('falls back to the ref itself when no remote claims it', () =>
  {
    expect(suggestedLocalBranchName('feature', remotes, [])).toBe('feature');
  });
});

describe('suggestedBranchNameAt', () =>
{
  const refs: RefAtRevision[] = [
    { name: 'main', fullName: 'refs/heads/main', sha: 'aaaa1111', kind: 'branch' },
    { name: 'origin/feature', fullName: 'refs/remotes/origin/feature', sha: 'bbbb2222', kind: 'remote' },
    { name: 'v1.0', fullName: 'refs/tags/v1.0', sha: 'bbbb2222', kind: 'tag' },
    { name: 'v2.0', fullName: 'refs/tags/v2.0', sha: 'cccc3333', kind: 'tag' }
  ];

  it('suggests the branch already on the commit', () =>
  {
    expect(suggestedBranchNameAt('aaaa1111', refs)).toBe('main');
  });

  it('drops the remote from a remote branch', () =>
  {
    expect(suggestedBranchNameAt('bbbb2222', refs)).toBe('feature');
  });

  it('prefers a branch over a tag on the same commit', () =>
  {
    // `bbbb2222` carries both: the first non-tag wins, with a tag as the fallback.
    expect(suggestedBranchNameAt('bbbb2222', refs)).not.toBe('v1.0');
  });

  it('falls back to a tag when that is all there is', () =>
  {
    expect(suggestedBranchNameAt('cccc3333', refs)).toBe('v2.0');
  });

  it('matches a short SHA as well as a full one', () =>
  {
    // The grid hands over a full SHA and the panel a name; a short one has to work too.
    expect(suggestedBranchNameAt('aaaa', refs)).toBe('main');
  });

  it('matches a ref by name, which is how the left panel spells it', () =>
  {
    expect(suggestedBranchNameAt('main', refs)).toBe('main');
  });

  it('matches a full ref name', () =>
  {
    expect(suggestedBranchNameAt('refs/heads/main', refs)).toBe('main');
  });

  it('suggests nothing when nothing points there', () =>
  {
    // Better than inventing a name out of a SHA, which is what "no suggestion" prevents.
    expect(suggestedBranchNameAt('deadbeef', refs)).toBe('');
  });

  it('does not match on a one-character prefix', () =>
  {
    // Two hex characters would match most of the repository.
    expect(suggestedBranchNameAt('a', refs)).toBe('');
  });

  it('suggests nothing for an empty revision', () =>
  {
    expect(suggestedBranchNameAt('', refs)).toBe('');
  });
});
