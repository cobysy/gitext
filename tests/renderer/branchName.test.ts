/**
 * Normalising a typed branch name.
 *
 * Every case is one of git's ten rules, by number, plus the ordering cases that are the
 * reason the rules run in reverse: a replacement made by an early rule can create a
 * violation of a later one.
 */

import { describe, expect, it } from 'vitest';
import { normaliseBranchName } from '@renderer/model/branchName.js';

describe('normaliseBranchName', () =>
{
  it('leaves a name that is already fine alone', () =>
  {
    expect(normaliseBranchName('feature/my-branch')).toBe('feature/my-branch');
  });

  it('is empty for whitespace, rather than a row of underscores', () =>
  {
    expect(normaliseBranchName('   ')).toBe('');
    expect(normaliseBranchName('')).toBe('');
  });

  describe('rule 1: a component may not start with a dot or end with .lock', () =>
  {
    it('replaces a leading dot', () =>
    {
      expect(normaliseBranchName('.hidden')).toBe('_hidden');
    });

    it('applies per component, not just at the front', () =>
    {
      expect(normaliseBranchName('feature/.hidden')).toBe('feature/_hidden');
    });

    it('replaces a trailing .lock, keeping the word', () =>
    {
      expect(normaliseBranchName('feature.lock')).toBe('feature_lock');
    });

    it('is case-insensitive about .lock, as git is', () =>
    {
      expect(normaliseBranchName('feature.LOCK')).toBe('feature_lock');
    });
  });

  describe('rule 3: no consecutive dots', () =>
  {
    it('replaces two', () =>
    {
      expect(normaliseBranchName('a..b')).toBe('a_b');
    });

    it('replaces a run of them with a single token', () =>
    {
      expect(normaliseBranchName('a....b')).toBe('a_b');
    });
  });

  describe('rule 4: no spaces, control characters, tilde, caret or colon', () =>
  {
    it('replaces a space', () =>
    {
      expect(normaliseBranchName('my branch')).toBe('my_branch');
    });

    it('replaces the whole punctuation set', () =>
    {
      expect(normaliseBranchName('a~b^c:d')).toBe('a_b_c_d');
    });

    it('keeps letters outside ASCII: git allows them', () =>
    {
      expect(normaliseBranchName('función/ünïcode')).toBe('función/ünïcode');
    });

    it('does not tear a surrogate pair in half', () =>
    {
      // Split by UTF-16 unit rather than by code point, an emoji would become two tokens.
      expect(normaliseBranchName('a🎉b')).toBe('a_b');
    });
  });

  describe('rule 5: no ?, * or [', () =>
  {
    it('replaces each', () =>
    {
      expect(normaliseBranchName('a?b*c[d')).toBe('a_b_c_d');
    });
  });

  describe('rule 6: no leading, trailing or repeated slashes', () =>
  {
    it('collapses a run', () =>
    {
      expect(normaliseBranchName('a//b')).toBe('a/b');
    });

    it('drops a leading slash', () =>
    {
      expect(normaliseBranchName('/feature')).toBe('feature');
    });

    it('drops a trailing slash', () =>
    {
      expect(normaliseBranchName('feature/')).toBe('feature');
    });

    it('keeps a trailing slash when the caller is normalising a prefix', () =>
    {
      expect(normaliseBranchName('feature/', { allowTrailingSlash: true })).toBe('feature/');
    });
  });

  describe('rule 7: cannot end with a dot', () =>
  {
    it('replaces it', () =>
    {
      expect(normaliseBranchName('feature.')).toBe('feature_');
    });
  });

  describe('rule 8: no @{ sequence', () =>
  {
    it('replaces it', () =>
    {
      expect(normaliseBranchName('feature@{1}')).toBe('feature_1}');
    });
  });

  describe('rule 9: cannot be the single character @', () =>
  {
    it('replaces the whole name', () =>
    {
      expect(normaliseBranchName('@')).toBe('_');
    });

    it('leaves an @ that is part of a longer name', () =>
    {
      expect(normaliseBranchName('user@host')).toBe('user@host');
    });
  });

  describe('rule 10: no backslash', () =>
  {
    it('replaces it', () =>
    {
      expect(normaliseBranchName('a\\b')).toBe('a_b');
    });
  });

  describe('the replacement token', () =>
  {
    it('can delete instead of replacing', () =>
    {
      expect(normaliseBranchName('my branch', { token: '' })).toBe('mybranch');
    });

    it('can be something else entirely', () =>
    {
      expect(normaliseBranchName('my branch', { token: '-' })).toBe('my-branch');
    });
  });

  describe('the ordering the reversed rules exist for', () =>
  {
    it('sweeps up slashes an earlier replacement left doubled', () =>
    {
      // Rule 4 turns the space into `/` when that is the token, which creates a rule 6
      // violation that did not exist in the input. Rule 6 runs second to last for this.
      expect(normaliseBranchName('a /b', { token: '/' })).toBe('a/b');
    });

    it('sweeps up a leading dot an earlier replacement created', () =>
    {
      // Rule 1 runs last so a component that only became dot-leading part-way through is
      // still caught.
      expect(normaliseBranchName('feature/ .x', { token: '' })).toBe('feature/x');
    });
  });

  it('turns a typed commit-message-shaped name into something git accepts', () =>
  {
    // The case the whole file exists for.
    expect(normaliseBranchName('fix: the thing')).toBe('fix__the_thing');
  });
});
