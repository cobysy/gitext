import { describe, expect, it } from 'vitest';
import { threeWayWordMerge, tokenize } from '@renderer/model/wordMerge.js';

describe('tokenize', () =>
{
  it('splits into runs of whitespace and non-whitespace', () =>
  {
    expect(tokenize('1 tsp salt')).toEqual(['1', ' ', 'tsp', ' ', 'salt']);
  });

  it('round-trips exactly, indentation and newlines included', () =>
  {
    const text = '  const x = 1;\n\tif (x) {\n\n}\n';
    expect(tokenize(text).join('')).toBe(text);
  });

  it('has no tokens for the empty string', () =>
  {
    expect(tokenize('')).toEqual([]);
  });
});

describe('threeWayWordMerge', () =>
{
  it('merges two edits to different words of the same line', () =>
  {
    // The case the whole module exists for: git conflicts on this, a person does not.
    expect(threeWayWordMerge('1 tsp salt', '2 tsp salt', '1 tsp sea salt')).toBe('2 tsp sea salt');
  });

  it('refuses when both sides changed the same word', () =>
  {
    expect(threeWayWordMerge('1 tsp salt', '2 tsp salt', '3 tsp salt')).toBeNull();
  });

  it('refuses when both sides insert at the same point', () =>
  {
    // Which of the two comes first is not a decision this can make.
    expect(threeWayWordMerge('a c', 'a b c', 'a x c')).toBeNull();
  });

  it('takes one side when the other did not change anything', () =>
  {
    expect(threeWayWordMerge('a b c', 'a b c', 'a B c')).toBe('a B c');
    expect(threeWayWordMerge('a b c', 'a B c', 'a b c')).toBe('a B c');
  });

  it('is the base when neither side changed anything', () =>
  {
    expect(threeWayWordMerge('a b c', 'a b c', 'a b c')).toBe('a b c');
  });

  it('merges a deletion on one side with an edit elsewhere on the other', () =>
  {
    expect(threeWayWordMerge('a b c d', 'a c d', 'a b c D')).toBe('a c D');
  });

  it('refuses when one side deletes what the other edited', () =>
  {
    expect(threeWayWordMerge('a b c', 'a c', 'a B c')).toBeNull();
  });

  it('preserves whitespace and indentation exactly', () =>
  {
    const base = '  int x = 1;';
    const ours = '  int x = 2;';
    const theirs = '  long x = 1;';
    expect(threeWayWordMerge(base, ours, theirs)).toBe('  long x = 2;');
  });

  it('merges across several lines of a block', () =>
  {
    const base = 'alpha\nbeta\ngamma';
    const ours = 'alpha\nBETA\ngamma';
    const theirs = 'alpha\nbeta\nGAMMA';
    expect(threeWayWordMerge(base, ours, theirs)).toBe('alpha\nBETA\nGAMMA');
  });

  it('handles a side that added a whole line', () =>
  {
    const base = 'a\nc';
    const ours = 'a\nb\nc';
    const theirs = 'A\nc';
    expect(threeWayWordMerge(base, ours, theirs)).toBe('A\nb\nc');
  });

  it('gives up rather than aligning an enormous block', () =>
  {
    // Well past MAX_TOKEN_PRODUCT: a rewrite that big is not two edits that might not
    // collide, and the answer after the work would be "conflicted" anyway.
    const huge = Array.from({ length: 4000 }, (_, i) => `tok${i}`).join(' ');
    expect(threeWayWordMerge(huge, `${huge} x`, `y ${huge}`)).toBeNull();
  });

  it('merges an empty base against two additions only when they are disjoint', () =>
  {
    // Both sides adding to nothing is an add/add: there is no way to order them.
    expect(threeWayWordMerge('', 'ours', 'theirs')).toBeNull();
  });
});
