/**
 * What the results pane draws: the grouping, and which characters may be shown as matched.
 *
 * The highlight is the half worth pinning. git reports the line it matched and never the
 * columns, so the span is recomputed here, and a span computed differently from the
 * search that produced it is a highlight over the wrong characters, which claims the app
 * understood a pattern it did not.
 */

import { describe, expect, it } from 'vitest';
import type { GrepHit } from '@shared/grep.js';
import { groupHits, highlightTerm, splitMatches } from '@renderer/model/grepResults.js';

const hit = (path: string, line: number, text = 'x'): GrepHit => ({ path, line, text });

describe('groupHits', () =>
{
  it('gathers a file matches under one heading, in git own order', () =>
  {
    const groups = groupHits([hit('a.txt', 1), hit('a.txt', 9), hit('b.txt', 2)]);
    expect(groups.map((group) => group.path)).toEqual(['a.txt', 'b.txt']);
    expect(groups[0]?.hits.map((entry) => entry.line)).toEqual([1, 9]);
  });

  it('opens a second group when a path comes back later, rather than reordering', () =>
  {
    // git prints a file's matches together, so this does not happen, and if it ever
    // does, showing the hits in the order they arrived beats silently re-sorting them.
    const groups = groupHits([hit('a.txt', 1), hit('b.txt', 2), hit('a.txt', 3)]);
    expect(groups.map((group) => group.path)).toEqual(['a.txt', 'b.txt', 'a.txt']);
  });

  it('is empty for no hits', () =>
  {
    expect(groupHits([])).toEqual([]);
  });
});

describe('highlightTerm', () =>
{
  it('is the pattern itself for a fixed-string search', () =>
  {
    expect(highlightTerm('needle', 'fixed')).toBe('needle');
  });

  it('is nothing for the three regex grammars, whose spans cannot be proved here', () =>
  {
    // POSIX basic reads `\(` as a group and `(` as a literal: the opposite way round
    // from JavaScript, and the other two disagree somewhere less obvious. None of them
    // may be re-matched with a JS RegExp and called the same match.
    for (const mode of ['basic', 'extended', 'perl'] as const)
    {
      expect(highlightTerm('need(le)', mode)).toBeNull();
    }
  });

  it('is nothing for an empty pattern', () =>
  {
    expect(highlightTerm('', 'fixed')).toBeNull();
  });
});

describe('splitMatches', () =>
{
  const plain = { ignoreCase: false, wholeWord: false };

  /** The runs, rendered back as text, must always reconstruct the line exactly. */
  const rejoin = (text: string, term: string | null, options = plain): string =>
    splitMatches(text, term, options)
      .map((run) => run.text)
      .join('');

  it('splits a line into plain and matched runs', () =>
  {
    expect(splitMatches('a needle here', 'needle', plain)).toEqual([
      { text: 'a ', match: false },
      { text: 'needle', match: true },
      { text: ' here', match: false }
    ]);
  });

  it('marks every occurrence, not only the first', () =>
  {
    const runs = splitMatches('foo(foo)', 'foo', plain);
    expect(runs.filter((run) => run.match)).toHaveLength(2);
  });

  it('matches case-insensitively when the search did, keeping the original text', () =>
  {
    const runs = splitMatches('A Needle', 'needle', { ignoreCase: true, wholeWord: false });
    expect(runs.find((run) => run.match)?.text).toBe('Needle');
  });

  it('respects -w, so a substring inside a longer word is not marked', () =>
  {
    const runs = splitMatches('foobar foo', 'foo', { ignoreCase: false, wholeWord: true });
    expect(runs.filter((run) => run.match)).toEqual([{ text: 'foo', match: true }]);
    expect(rejoin('foobar foo', 'foo', { ignoreCase: false, wholeWord: true })).toBe(
      'foobar foo'
    );
  });

  it('draws the whole line unmarked when there is no term', () =>
  {
    expect(splitMatches('anything', null, plain)).toEqual([{ text: 'anything', match: false }]);
  });

  it('draws the whole line unmarked when the term cannot be found in it', () =>
  {
    // A hit git made on a rule this does not model must still be a row.
    expect(splitMatches('a line', 'zzz', plain)).toEqual([{ text: 'a line', match: false }]);
  });

  it('never loses or invents a character', () =>
  {
    for (const text of ['needle', 'needleneedle', ' needle ', 'x', ''])
    {
      expect(rejoin(text, 'needle')).toBe(text);
    }
  });
});
