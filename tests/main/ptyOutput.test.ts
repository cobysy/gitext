/** The two artifacts of forcing git into a pty: see `main/git/runner/ptyOutput.ts`. */

import { describe, expect, it } from 'vitest';
import {
  collapseOverwrites,
  normalizeCrlf,
  sanitizePtyChunk,
  stripEofEcho,
  terminalLine
} from '@main/git/runner/ptyOutput.js';

describe('stripEofEcho', () =>
{
  it('strips the leading ^D and backspaces on the first chunk', () =>
  {
    // The exact byte sequence observed from a real `script -q /dev/null git status` session.
    expect(stripEofEcho('^D\b\bOn branch main\r\n', true)).toBe('On branch main\r\n');
  });

  it('leaves a later chunk untouched even if it happens to start the same way', () =>
  {
    expect(stripEofEcho('^D\b\bnot an echo', false)).toBe('^D\b\bnot an echo');
  });

  it('leaves a first chunk untouched when it carries no echo', () =>
  {
    expect(stripEofEcho('Enumerating objects: 1, done.\r\n', true)).toBe(
      'Enumerating objects: 1, done.\r\n'
    );
  });
});

describe('normalizeCrlf', () =>
{
  it('collapses every CRLF to a plain newline', () =>
  {
    expect(normalizeCrlf('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('leaves a lone CR (a git progress tick) alone', () =>
  {
    expect(normalizeCrlf('Counting objects:  50% (5/10)\r')).toBe('Counting objects:  50% (5/10)\r');
  });
});

describe('collapseOverwrites', () =>
{
  it('keeps only what a progress meter last wrote to the line', () =>
  {
    const ticks =
      'Counting objects:  50% (5/10)\rCounting objects: 100% (10/10)\rCounting objects: 100% (10/10), done.';
    expect(collapseOverwrites(ticks)).toBe('Counting objects: 100% (10/10), done.');
  });

  it('leaves a line that was never overwritten alone', () =>
  {
    expect(collapseOverwrites('Enumerating objects: 6862, done.')).toBe(
      'Enumerating objects: 6862, done.'
    );
  });
});

describe('sanitizePtyChunk', () =>
{
  it('strips the echo and normalizes line endings together, on the first chunk', () =>
  {
    expect(sanitizePtyChunk('^D\b\bOn branch main\r\nnothing to commit\r\n', true)).toBe(
      'On branch main\nnothing to commit\n'
    );
  });

  it('only normalizes line endings on later chunks', () =>
  {
    expect(sanitizePtyChunk('more output\r\n', false)).toBe('more output\n');
  });
});

describe('a progress meter over a pipe', () =>
{
  /**
   * What `git push --progress` actually writes: ticks separated by `\r`, with no
   * newline until the phase ends. Captured from a real push. Held as one line by a
   * splitter that only knows `\n`, which is why the console needs the partial line
   * reported as it moves and collapsed to its latest write.
   */
  const PHASE =
    'Counting objects:   0% (1/402)\rCounting objects:   1% (5/402)\rCounting objects: 100% (402/402)';

  it('reads as its latest tick, not as every tick run together', () =>
  {
    expect(collapseOverwrites(PHASE)).toBe('Counting objects: 100% (402/402)');
  });
});

describe('terminalLine', () =>
{
  it('keeps a plain line as it is', () =>
  {
    expect(terminalLine('From github.com:owner/repo')).toBe('From github.com:owner/repo');
  });

  it('shows a progress line as what it ended up saying', () =>
  {
    expect(terminalLine('Receiving objects:  50% (1/2)\rReceiving objects: 100% (2/2).')).toBe(
      'Receiving objects: 100% (2/2).'
    );
  });

  it('treats a CRLF ending as an ending, not as a rewrite', () =>
  {
    // A diff of a file with CRLF endings: every line arrives this way, and taking the
    // `\r` as a rewrite would leave the record and the console window both blank.
    expect(terminalLine('+first line\r')).toBe('+first line');
  });

  it('still collapses a rewrite on a line that also ends CRLF', () =>
  {
    expect(terminalLine('Counting objects:  10%\rCounting objects: 100%, done.\r')).toBe(
      'Counting objects: 100%, done.'
    );
  });
});
