/** A run's clock: whole seconds, then minutes and seconds. */

import { describe, expect, it } from 'vitest';
import { elapsedText } from '@renderer/model/elapsed.js';

describe('elapsedText', () =>
{
  it('counts whole seconds, never fractions', () =>
  {
    expect(elapsedText(0)).toBe('0s');
    expect(elapsedText(1999)).toBe('1s');
    expect(elapsedText(59_999)).toBe('59s');
  });

  it('turns to minutes at sixty, the seconds kept at two digits', () =>
  {
    expect(elapsedText(60_000)).toBe('1m 00s');
    expect(elapsedText(125_000)).toBe('2m 05s');
  });
});
