/**
 * Editing a commit message as text.
 *
 * The rules worth pinning are the ones about *not losing what is there*: a prefix swap
 * that keeps the scope, and a template that lands beside a typed subject rather than on
 * top of it. A text box has no undo to get either back from.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPrefix,
  authorLine,
  CONVENTIONAL_PREFIXES,
  nextPrefix,
  parsePrefix,
  withMessageText
} from '@renderer/model/commitMessage.js';

describe('parsePrefix', () =>
{
  it('reads a bare type', () =>
  {
    expect(parsePrefix('feat: add the thing')).toEqual({
      type: 'feat',
      scope: '',
      breaking: false,
      rest: 'add the thing'
    });
  });

  it('reads a scope and a breaking marker', () =>
  {
    expect(parsePrefix('fix(parser)!: reject a NUL')).toEqual({
      type: 'fix',
      scope: '(parser)',
      breaking: true,
      rest: 'reject a NUL'
    });
  });

  it('leaves prose that merely starts like a prefix alone', () =>
  {
    // "fixed:" is a sentence, not a type. Rewriting the first word of somebody's message
    // because it resembles one is worse than doing nothing.
    expect(parsePrefix('fixed: the build')).toBeNull();
    expect(parsePrefix('note: see the ticket')).toBeNull();
  });

  it('is anchored: a prefix in the middle of a line is not one', () =>
  {
    expect(parsePrefix('see also feat: something')).toBeNull();
  });
});

describe('applyPrefix', () =>
{
  it('adds one to a message that has none', () =>
  {
    expect(applyPrefix('add the thing', 'feat')).toBe('feat: add the thing');
  });

  it('replaces the type and keeps the scope and the breaking marker', () =>
  {
    // The half that earns the function: retyping `(parser)!` after every correction is
    // exactly the friction that stops people using the picker.
    expect(applyPrefix('fix(parser)!: reject a NUL', 'refactor')).toBe(
      'refactor(parser)!: reject a NUL'
    );
  });

  it('does not leave a stray space on an empty message', () =>
  {
    expect(applyPrefix('', 'feat')).toBe('feat: ');
  });

  it('keeps the body of a multi-line message', () =>
  {
    expect(applyPrefix('feat: subject\n\nthe body', 'fix')).toBe('fix: subject\n\nthe body');
  });
});

describe('nextPrefix', () =>
{
  it('starts at the first type', () =>
  {
    expect(nextPrefix('add the thing')).toBe(CONVENTIONAL_PREFIXES[0]!.type);
  });

  it('steps to the next', () =>
  {
    expect(nextPrefix('feat: x')).toBe(CONVENTIONAL_PREFIXES[1]!.type);
  });

  it('wraps round from the last', () =>
  {
    const last = CONVENTIONAL_PREFIXES[CONVENTIONAL_PREFIXES.length - 1]!.type;
    expect(nextPrefix(`${last}: x`)).toBe(CONVENTIONAL_PREFIXES[0]!.type);
  });
});

describe('withMessageText', () =>
{
  it('fills an empty box outright', () =>
  {
    expect(withMessageText('', 'A template')).toBe('A template');
    expect(withMessageText('   \n ', 'A template')).toBe('A template');
  });

  it('never replaces what is already typed', () =>
  {
    // The one thing it must not do: a template chosen after a subject was written would
    // otherwise discard it silently.
    expect(withMessageText('my subject', 'Checklist:\n- one')).toBe(
      'my subject\n\nChecklist:\n- one'
    );
  });

  it('leaves the message alone when there is nothing to add', () =>
  {
    expect(withMessageText('my subject', '   ')).toBe('my subject');
  });

  it('does not stack up blank lines', () =>
  {
    expect(withMessageText('my subject\n\n\n', 'more')).toBe('my subject\n\nmore');
  });
});

describe('authorLine', () =>
{
  it('is the form --author wants', () =>
  {
    expect(authorLine('Ada Lovelace', 'ada@example.com')).toBe('Ada Lovelace <ada@example.com>');
  });
});
