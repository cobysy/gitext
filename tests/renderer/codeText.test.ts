/**
 * The rule every line of UI text is written to: a span between backticks is a git token.
 *
 * Worth its own file because four surfaces render through it now, a hint, a form label, a
 * confirmation and a toast, and the grammar has exactly one rule. The cases that matter
 * are the ones that decide what a *user* sees when the text is not perfectly formed: an
 * unclosed mark, an empty span, and text that carries no mark at all.
 */

import { describe, expect, it } from 'vitest';
import { codeSegments } from '@renderer/model/codeText.js';

/** What actually reaches the code font, in order. */
const codeIn = (text: string): string[] =>
  codeSegments(text).filter((segment) => segment.code).map((segment) => segment.value);

describe('codeSegments', () =>
{
  it('marks a backticked span as code and leaves the prose around it alone', () =>
  {
    expect(codeSegments('Off is `--no-commit`: the changes land staged.')).toEqual([
      { value: 'Off is ', code: false },
      { value: '--no-commit', code: true },
      { value: ': the changes land staged.', code: false }
    ]);
  });

  it('marks every token in a line, not just the first', () =>
  {
    expect(codeIn('`--force` overwrites; `--force-with-lease` stops if the remote moved.'))
      .toEqual(['--force', '--force-with-lease']);
  });

  it('leaves text with no backticks as one plain segment', () =>
  {
    expect(codeSegments('Your changes were stashed. Pop them back on top?')).toEqual([
      { value: 'Your changes were stashed. Pop them back on top?', code: false }
    ]);
  });

  it('leaves the tail of an unclosed backtick plain', () =>
  {
    // git's own stderr reaches a toast unedited, so an odd backtick has to read as prose
    // rather than swallowing the rest of the line into the code font.
    expect(codeIn('error: pathspec `main did not match')).toEqual([]);
    // And the mark itself survives, so the line reads as it was written.
    expect(codeSegments('error: pathspec `main did not match').map((s) => s.value).join(''))
      .toBe('error: pathspec `main did not match');
  });

  it('keeps a branch name with a space in it as one token', () =>
  {
    expect(codeIn('Delete `feature/two words`?')).toEqual(['feature/two words']);
  });
});
