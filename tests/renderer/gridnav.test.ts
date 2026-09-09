/**
 * Grid row movement and quick-search matching.
 *
 * Worth unit-testing rather than driving with a keyboard: the interesting cases are
 * the ends of the list (arrowing past the last row, paging further than the history
 * is long), an empty grid, and a search that wraps around: all of which either look
 * identical to "nothing happened" on screen or need a repository of a particular
 * shape to reach at all.
 */

import { describe, expect, it } from 'vitest';
import {
  findQuickSearchMatch,
  matchesQuickSearch,
  stepRow,
  type SearchableRow
} from '@renderer/gridnav.js';

/** A row with only the fields quick search reads; the rest of `CommitRow` is noise. */
function row(partial: Partial<SearchableRow> & { sha: string }): SearchableRow
{
  return { subject: '', body: '', authorName: '', refs: [], ...partial };
}

const history: SearchableRow[] = [
  row({ sha: 'aaaa111', subject: 'Add the parser', authorName: 'Ada' }),
  row({ sha: 'bbbb222', subject: 'Fix a crash', authorName: 'Grace', refs: [{ name: 'main' }] }),
  row({ sha: 'cccc333', subject: 'Tidy up', body: 'Also removes the parser hack', authorName: 'Ada' }),
  row({ sha: 'dddd444', subject: 'Release', authorName: 'Alan', refs: [{ name: 'v1.0' }] })
];

describe('stepRow', () =>
{
  it('moves by the delta', () =>
  {
    expect(stepRow(1, 1, 4)).toBe(2);
    expect(stepRow(3, -2, 4)).toBe(1);
  });

  it('clamps at both ends rather than wrapping', () =>
  {
    expect(stepRow(3, 1, 4)).toBe(3);
    expect(stepRow(0, -1, 4)).toBe(0);
    // Paging past the end lands on the end, which is what End would do anyway.
    expect(stepRow(1, 40, 4)).toBe(3);
    expect(stepRow(2, -40, 4)).toBe(0);
  });

  it('starts at the top when nothing is selected, whichever way it was asked to move', () =>
  {
    expect(stepRow(undefined, 1, 4)).toBe(0);
    expect(stepRow(undefined, -1, 4)).toBe(0);
  });

  it('has nowhere to go in an empty grid', () =>
  {
    expect(stepRow(undefined, 1, 0)).toBeUndefined();
    expect(stepRow(0, 1, 0)).toBeUndefined();
  });
});

describe('matchesQuickSearch', () =>
{
  it('matches the subject and the body, case-insensitively', () =>
  {
    expect(matchesQuickSearch(history[0]!, 'PARSER')).toBe(true);
    // The body, not just the first line: the term is often in the detail.
    expect(matchesQuickSearch(history[2]!, 'parser hack')).toBe(true);
  });

  it('matches the author', () =>
  {
    expect(matchesQuickSearch(history[1]!, 'grace')).toBe(true);
  });

  it('matches a ref name, including a tag', () =>
  {
    expect(matchesQuickSearch(history[1]!, 'main')).toBe(true);
    expect(matchesQuickSearch(history[3]!, 'v1.0')).toBe(true);
  });

  it('matches a SHA prefix only from three characters', () =>
  {
    expect(matchesQuickSearch(history[0]!, 'aaa')).toBe(true);
    // Two hex digits match some commit in every repository, so "ad" on the way to
    // "add" must not drag the selection off to an unrelated SHA.
    expect(matchesQuickSearch(history[0]!, 'aa')).toBe(false);
    // Mid-SHA is not a prefix.
    expect(matchesQuickSearch(history[0]!, '111')).toBe(false);
  });

  it('never matches on an empty or blank term', () =>
  {
    expect(matchesQuickSearch(history[0]!, '')).toBe(false);
    expect(matchesQuickSearch(history[0]!, '   ')).toBe(false);
  });
});

describe('findQuickSearchMatch', () =>
{
  it('finds forwards from the starting row, inclusive', () =>
  {
    // Inclusive is what lets typing another character refine the term without the
    // selection skipping past the row it already found.
    expect(findQuickSearchMatch(history, 'ada', 0, 1)).toBe(0);
    expect(findQuickSearchMatch(history, 'ada', 1, 1)).toBe(2);
  });

  it('finds backwards', () =>
  {
    expect(findQuickSearchMatch(history, 'ada', 3, -1)).toBe(2);
  });

  it('wraps past the end and past the top', () =>
  {
    expect(findQuickSearchMatch(history, 'grace', 3, 1)).toBe(1);
    expect(findQuickSearchMatch(history, 'release', 0, -1)).toBe(3);
  });

  it('returns undefined when nothing matches, rather than a row', () =>
  {
    expect(findQuickSearchMatch(history, 'zzzz', 0, 1)).toBeUndefined();
  });

  it('handles an empty grid and an empty term', () =>
  {
    expect(findQuickSearchMatch([], 'ada', 0, 1)).toBeUndefined();
    expect(findQuickSearchMatch(history, '', 0, 1)).toBeUndefined();
  });

  it('accepts a starting row past either end of the list', () =>
  {
    // The callers add ±1 to the selected row without clamping first, so row -1 and row
    // `count` both have to mean something. Modulo in the wrong direction would throw
    // this into a negative index and quietly match nothing.
    expect(findQuickSearchMatch(history, 'release', 4, 1)).toBe(3);
    expect(findQuickSearchMatch(history, 'add', -1, -1)).toBe(0);
  });
});
