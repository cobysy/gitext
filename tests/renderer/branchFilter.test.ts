import { describe, expect, it } from 'vitest';
import { tokenizeBranchFilter } from '@renderer/model/branchFilter.js';

describe('tokenizeBranchFilter', () =>
{
  it('splits on whitespace', () =>
  {
    expect(tokenizeBranchFilter('main release-1.0')).toEqual(['main', 'release-1.0']);
  });

  it('collapses runs of whitespace rather than producing empty tokens', () =>
  {
    expect(tokenizeBranchFilter('main   release-1.0')).toEqual(['main', 'release-1.0']);
  });

  it('trims leading and trailing whitespace', () =>
  {
    expect(tokenizeBranchFilter('  main  ')).toEqual(['main']);
  });

  it('answers an empty list for blank text', () =>
  {
    expect(tokenizeBranchFilter('')).toEqual([]);
    expect(tokenizeBranchFilter('   ')).toEqual([]);
  });

  it('keeps a wildcard token intact: buildLogArgs decides what to do with it', () =>
  {
    expect(tokenizeBranchFilter('feature/* release-*')).toEqual(['feature/*', 'release-*']);
  });
});
