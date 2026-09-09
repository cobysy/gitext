/**
 * `%P` as git actually prints it. The three cases are a root commit (the field is
 * empty), an ordinary commit (one SHA), and a merge (two or more, space-separated),
 * and the readers of this field had disagreed about the first one.
 */

import { describe, expect, it } from 'vitest';
import { parseParents } from '@shared/parents.js';

describe('parseParents', () =>
{
  it('gives a root commit no parents rather than one empty string', () =>
  {
    expect(parseParents('')).toEqual([]);
    expect(parseParents('   ')).toEqual([]);
  });

  it('reads one parent, and a merge\'s several, in git\'s own order', () =>
  {
    expect(parseParents('a'.repeat(40))).toEqual(['a'.repeat(40)]);
    expect(parseParents(`${'a'.repeat(40)} ${'b'.repeat(40)}`)).toEqual([
      'a'.repeat(40),
      'b'.repeat(40)
    ]);
  });

  it('survives the newline `--format` leaves on the end of a record', () =>
  {
    expect(parseParents(' abc def \n')).toEqual(['abc', 'def']);
  });
});
