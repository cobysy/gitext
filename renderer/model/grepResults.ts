/**
 * Turning a flat list of `git grep` hits into what the results pane draws.
 *
 * Pure and DOM-free, so the two decisions here are unit tests rather than something only
 * a screenshot could check: how hits are grouped, and which part of a line may be shown
 * as the match.
 */

import type { GrepHit, GrepMode } from '@shared/grep.js';

const GREP_MODE_FIXED = 'fixed';

export interface GrepFileGroup {
  path: string;
  hits: readonly GrepHit[];
}

/**
 * Group hits by file, preserving git's order (not sorting: matches ls-files order used elsewhere).
 */
export function groupHits(hits: readonly GrepHit[]): GrepFileGroup[]
{
  const groups: GrepFileGroup[] = [];
  let current: { path: string; hits: GrepHit[] } | null = null;

  for (const hit of hits)
  {
    if (!current || current.path !== hit.path)
    {
      current = { path: hit.path, hits: [] };
      groups.push(current);
    }
    current.hits.push(hit);
  }

  return groups;
}

/**
 * Term to highlight, or null. Only fixed-string searches get highlights (regex grammars disagree with JS).
 */
export function highlightTerm(pattern: string, mode: GrepMode): string | null
{
  if (mode === GREP_MODE_FIXED && pattern.length > 0)
  {
    return pattern;
  }
  else
  {
    return null;
  }
}

export interface TextRun {
  text: string;
  match: boolean;
}

export interface MatchOptions {
  ignoreCase: boolean;
  /**
   * `-w` flag: only whole-word matches. Highlight must match what search produced.
   */
  wholeWord: boolean;
}

const WORD = /[A-Za-z0-9_]/;

function isWholeWord(text: string, at: number, length: number): boolean
{
  // The characters either side, or nothing at all at the ends of the line: where there is
  // no character, there is no word to be part of.
  let before;
  if (at > 0)
  {
    before = text[at - 1] ?? '';
  }
  else
  {
    before = '';
  }
  let after;
  if (at + length < text.length)
  {
    after = text[at + length] ?? '';
  }
  else
  {
    after = '';
  }
  return !WORD.test(before) && !WORD.test(after);
}

/**
 * Split a line into alternating plain and matched runs.
 *
 * Every occurrence, not just the first: a line matches once as far as git is concerned,
 * but `foo(foo)` has two and highlighting one of them reads as a rendering fault.
 */
export function splitMatches(
  text: string,
  term: string | null,
  options: MatchOptions
): TextRun[]
{
  if (!term)
  {
    return [{ text, match: false }];
  }

  let haystack;
  if (options.ignoreCase)
  {
    haystack = text.toLowerCase();
  }
  else
  {
    haystack = text;
  }
  let needle;
  if (options.ignoreCase)
  {
    needle = term.toLowerCase();
  }
  else
  {
    needle = term;
  }
  const runs: TextRun[] = [];
  let at = 0;
  let plainFrom = 0;

  for (;;)
  {
    const found = haystack.indexOf(needle, at);
    if (found === -1)
    {
      break;
    }
    at = found + needle.length;
    if (options.wholeWord && !isWholeWord(text, found, needle.length))
    {
      continue;
    }
    if (found > plainFrom)
    {
      runs.push({ text: text.slice(plainFrom, found), match: false });
    }
    runs.push({ text: text.slice(found, found + needle.length), match: true });
    plainFrom = at;
  }

  if (plainFrom < text.length)
  {
    runs.push({ text: text.slice(plainFrom), match: false });
  }
  // A line git matched that this can find no span in is still a hit and must still be
  // drawn: the whole line, unhighlighted, rather than nothing at all.
  if (runs.length > 0)
  {
    return runs;
  }
  else
  {
    return [{ text, match: false }];
  }
}
