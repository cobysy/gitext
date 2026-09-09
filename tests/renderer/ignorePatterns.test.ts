/**
 * The four ways of writing "ignore this", and the duplicate check.
 *
 * Both halves matter: appending the raw path to `.git/info/exclude` with no window at all
 * asks neither what shape the rule should be nor whether the file already carries it.
 */

import { describe, expect, it } from 'vitest';
import { buildMoveArgs } from '@renderer/model/args/file.js';
import {
  existingRules,
  IGNORE_STYLES,
  ignorePatternFor,
  ignorePatternsFor,
  newRules
} from '@renderer/model/ignorePatterns.js';

describe('ignorePatternFor', () =>
{
  const path = 'src/build/app.log';

  it('the file itself, anchored at the root', () =>
  {
    expect(ignorePatternFor('path', path)).toBe('/src/build/app.log');
  });

  it('the name anywhere', () =>
  {
    expect(ignorePatternFor('name', path)).toBe('app.log');
  });

  it('the extension', () =>
  {
    expect(ignorePatternFor('extension', path)).toBe('*.log');
  });

  it('the folder, with the trailing slash that makes it a directory rule', () =>
  {
    expect(ignorePatternFor('folder', path)).toBe('/src/build/');
  });

  it('a file at the repository root has no folder rule', () =>
  {
    expect(ignorePatternFor('folder', 'notes.txt')).toBeNull();
    expect(ignorePatternFor('path', 'notes.txt')).toBe('/notes.txt');
  });

  it('a file with no extension has no extension rule', () =>
  {
    // Null rather than falling back to the path: writing the full path under a radio
    // labelled "every file with this extension" is a rule nobody chose.
    expect(ignorePatternFor('extension', 'Makefile')).toBeNull();
  });

  it('a dotfile is a name, not an extension', () =>
  {
    expect(ignorePatternFor('extension', '.gitignore')).toBeNull();
    expect(ignorePatternFor('name', 'config/.env')).toBe('.env');
  });

  it('custom produces nothing: it is the box, not a rule', () =>
  {
    for (const entry of IGNORE_STYLES)
    {
      const pattern = ignorePatternFor(entry.style, path);
      if (entry.style === 'custom')
      {
        expect(pattern).toBeNull();
      }
      else
      {
        expect(pattern).toBeTruthy();
      }
    }
  });

  it('is empty for an empty path', () =>
  {
    expect(ignorePatternFor('path', '   ')).toBeNull();
  });
});

describe('ignorePatternsFor', () =>
{
  it('one line per path', () =>
  {
    expect(ignorePatternsFor('name', ['a/x.log', 'b/y.log'])).toEqual(['x.log', 'y.log']);
  });

  it('collapses two files in one folder into one folder rule', () =>
  {
    expect(ignorePatternsFor('folder', ['build/a.js', 'build/b.js'])).toEqual(['/build/']);
  });

  it('drops the paths this style cannot express, rather than the whole answer', () =>
  {
    expect(ignorePatternsFor('extension', ['Makefile', 'a.log'])).toEqual(['*.log']);
  });
});

describe('newRules', () =>
{
  const file = '# build output\nnode_modules/\n\n*.log\n';

  it('reads a rule already in the file', () =>
  {
    expect(existingRules(file)).toEqual(['node_modules/', '*.log']);
  });

  it('drops what is already there', () =>
  {
    expect(newRules(file, ['*.log', 'dist/'])).toEqual(['dist/']);
  });

  it('ignores comments when deciding: a commented-out rule is not a rule', () =>
  {
    expect(newRules('# *.log\n', ['*.log'])).toEqual(['*.log']);
  });

  it('never writes the same line twice in one go', () =>
  {
    expect(newRules('', ['dist/', 'dist/'])).toEqual(['dist/']);
  });

  it('is empty when everything asked for is already ignored', () =>
  {
    expect(newRules(file, ['*.log', 'node_modules/'])).toEqual([]);
  });
});

describe('buildMoveArgs', () =>
{
  it('is git mv with the separator', () =>
  {
    expect(buildMoveArgs('old.txt', 'new.txt')).toEqual(['mv', '--', 'old.txt', 'new.txt']);
  });

  it('is empty when the name has not changed, so the button has nothing to run', () =>
  {
    expect(buildMoveArgs('a.txt', 'a.txt')).toEqual([]);
    expect(buildMoveArgs('a.txt', '  ')).toEqual([]);
  });
});
