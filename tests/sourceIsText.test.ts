/**
 * No source file carries a raw control character.
 *
 * A NUL in a file makes every tool that guesses at binary-ness guess wrong. `git diff` says
 * `Binary files differ`, which `.gitattributes` now overrides, and the note there records
 * what it cost, but nothing overrides `grep`, which either reports `Binary file … matches`
 * with no line, or skips the file outright when it is told to ignore binaries. A file that
 * silently answers no search is worse than one that is merely hard to read, and this
 * codebase is navigated by search.
 *
 * The characters are not the problem; writing them as bytes instead of as escapes is.
 * `'\x00'` is the same string to JavaScript and an ordinary one to everything else.
 *
 * Tab, newline and carriage return are exempt: they are how a text file is laid out.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourceFiles } from './sourceFiles.js';

const TAB = 0x09;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DELETE = 0x7f;

/** True for a byte no source file should carry literally. */
function isRawControl(byte: number): boolean
{
  if (byte === TAB || byte === NEWLINE || byte === CARRIAGE_RETURN)
  {
    return false;
  }
  return byte < 0x20 || byte === DELETE;
}

/** Every file carrying one, named with the character it carries. */
function offenders(): string[]
{
  const found: string[] = [];
  for (const path of sourceFiles())
  {
    const bytes = readFileSync(path);
    const codes = new Set<number>();
    for (const byte of bytes)
    {
      if (isRawControl(byte))
      {
        codes.add(byte);
      }
    }
    if (codes.size > 0)
    {
      const named = [...codes].map((c) => `0x${c.toString(16).padStart(2, '0')}`).join(', ');
      found.push(`${relative(ROOT, path)} carries ${named}: write it as an escape instead`);
    }
  }
  return found;
}

describe('every source file is text', () =>
{
  it('carries no raw control character', () =>
  {
    expect(offenders()).toEqual([]);
  });

  /** The scan has to be looking at something, or an empty answer means nothing. */
  it('is looking at the whole tree', () =>
  {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.endsWith('CommitScreen.vue'))).toBe(true);
  });
});
