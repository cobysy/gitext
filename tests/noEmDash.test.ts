/**
 * No file carries an em dash.
 *
 * Not a typographic preference: an em dash reads as filler. It joins two clauses without
 * saying how they relate, so a sentence can carry two or three of them and still not
 * commit to an order of thought, and a UI hint built that way takes a second read to
 * parse. The punctuation that replaces it has to say something:
 *
 * | write | when |
 * |---|---|
 * | a colon, `--no-ff: always records the merge` | the left side introduces the right |
 * | a comma, `it stops, which is the point` | an aside or a relative clause |
 * | two commas, `a pair, like this one, of them` | a bracketed aside |
 * | a full stop, `One thing. Then another.` | two statements |
 * | a middot, `main · 50 changed` | a separator between items, not prose |
 *
 * The middot is the answer to the one job a hyphen genuinely cannot do: separating items
 * on a single line, in a status bar or a row of chips. It is not punctuation for a
 * sentence.
 *
 * An en dash is no better and is banned with it, so neither can stand in for the other.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourceFiles } from './sourceFiles.js';

/**
 * The characters, and the escapes that produce them.
 *
 * The escape is the half that hides: a `\\u` escape is the character to everything that
 * reads the string and six ordinary characters to everything that reads the file, so a
 * scan for the character alone passes straight over it. Two test files had one, and the
 * only reason it surfaced was an assertion failing against a source string that had
 * already been fixed.
 */
const EM_DASH = 0x2014;
const EN_DASH = 0x2013;
const BACKSLASH = '\\';

/** One code point, in every spelling a source file can reach it by. */
function spellings(code: number, entity: string): string[]
{
  return [
    String.fromCodePoint(code),
    `${BACKSLASH}u${code.toString(16)}`,
    `${BACKSLASH}x{${code.toString(16)}}`,
    `&#${code};`,
    `&${entity};`
  ];
}

// Assembled rather than written out, so this file holds itself to the rule like any
// other. A test with an exemption is a rule with a hole in it.
const BANNED = [...spellings(EM_DASH, 'mdash'), ...spellings(EN_DASH, 'ndash')];

/** Every file carrying one, with the line and enough of it to find. */
function offenders(): string[]
{
  const found: string[] = [];
  for (const path of sourceFiles())
  {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) =>
    {
      const carries = BANNED.find((banned) => line.includes(banned));
      if (carries !== undefined)
      {
        found.push(`${relative(ROOT, path)}:${index + 1}: ${line.trim().slice(0, 80)}`);
      }
    });
  }
  return found;
}

describe('punctuation', () =>
{
  it('uses no em dash or en dash anywhere', () =>
  {
    expect(offenders()).toEqual([]);
  });

  /** The scan has to be looking at something, or an empty answer means nothing. */
  it('is looking at the whole tree', () =>
  {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.endsWith('CommitScreen.vue'))).toBe(true);
    expect(files.some((f) => f.endsWith('CLAUDE.md'))).toBe(true);
  });
});
