import { describe, expect, it } from 'vitest';
import {
  hasConflictMarkers,
  parseConflictBlocks,
  resolveConflictBlock
} from '@renderer/model/conflictMarkers.js';

describe('parseConflictBlocks', () =>
{
  it('finds a single default-style block', () =>
  {
    const text = ['one', '<<<<<<< HEAD', 'ours line', '=======', 'theirs line', '>>>>>>> feature', 'two'].join(
      '\n'
    );
    const blocks = parseConflictBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      startLine: 2,
      endLine: 6,
      midLine: 4,
      baseMarkerLine: null,
      oursLabel: 'HEAD',
      theirsLabel: 'feature',
      oursLines: ['ours line'],
      theirsLines: ['theirs line'],
      // Git's default style writes no ancestor into the file; `conflictAutoMerge.ts`
      // works the region out from the base blob instead.
      baseLines: null
    });
  });

  it('finds several blocks in one file, in order', () =>
  {
    const text = [
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> feature',
      'clean line',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> feature'
    ].join('\n');
    const blocks = parseConflictBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.oursLines).toEqual(['a']);
    expect(blocks[1]!.oursLines).toEqual(['c']);
  });

  it('keeps the diff3 base section apart from ours and theirs', () =>
  {
    const text = [
      '<<<<<<< HEAD',
      'ours line',
      '||||||| merged common ancestors',
      'base line',
      '=======',
      'theirs line',
      '>>>>>>> feature'
    ].join('\n');
    const blocks = parseConflictBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.oursLines).toEqual(['ours line']);
    expect(blocks[0]!.theirsLines).toEqual(['theirs line']);
    // Where git has already said what the ancestor is, nothing should be inferring it.
    expect(blocks[0]!.baseLines).toEqual(['base line']);
    // Ours stops at the `|||||||` line, not at `=======`, which is three lines further on.
    expect(blocks[0]!.baseMarkerLine).toBe(3);
    expect(blocks[0]!.midLine).toBe(5);
  });

  it('finds no blocks in a clean file', () =>
  {
    expect(parseConflictBlocks('one\ntwo\nthree')).toEqual([]);
  });

  it('skips a block missing its closing marker rather than throwing', () =>
  {
    const text = ['<<<<<<< HEAD', 'ours line', '======='].join('\n');
    expect(parseConflictBlocks(text)).toEqual([]);
  });

  it('handles a conflict at the very start and end of the file', () =>
  {
    const text = ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature'].join('\n');
    const blocks = parseConflictBlocks(text);
    expect(blocks).toEqual([
      {
        startLine: 1,
        endLine: 5,
        midLine: 3,
        baseMarkerLine: null,
        oursLabel: 'HEAD',
        theirsLabel: 'feature',
        oursLines: ['a'],
        theirsLines: ['b'],
        baseLines: null
      }
    ]);
  });
});

describe('resolveConflictBlock', () =>
{
  const text = ['one', '<<<<<<< HEAD', 'ours line', '=======', 'theirs line', '>>>>>>> feature', 'two'].join(
    '\n'
  );
  const block = parseConflictBlocks(text)[0]!;

  it('keeps ours', () =>
  {
    expect(resolveConflictBlock(text, block, 'ours', null)).toBe('one\nours line\ntwo');
  });

  it('keeps theirs', () =>
  {
    expect(resolveConflictBlock(text, block, 'theirs', null)).toBe('one\ntheirs line\ntwo');
  });

  it('keeps both, ours first', () =>
  {
    expect(resolveConflictBlock(text, block, 'oursThenTheirs', null)).toBe(
      'one\nours line\ntheirs line\ntwo'
    );
  });

  it('keeps both, theirs first', () =>
  {
    expect(resolveConflictBlock(text, block, 'theirsThenOurs', null)).toBe(
      'one\ntheirs line\nours line\ntwo'
    );
  });

  it('keeps the base when one was fetched', () =>
  {
    expect(resolveConflictBlock(text, block, 'base', ['base line'])).toBe('one\nbase line\ntwo');
  });

  it('drops the block entirely when there is no base to fall back to', () =>
  {
    expect(resolveConflictBlock(text, block, 'base', null)).toBe('one\ntwo');
  });

  it('leaves the rest of the file untouched when several blocks are resolved in turn', () =>
  {
    const twoBlocks = [
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> feature',
      'clean line',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> feature'
    ].join('\n');
    const first = parseConflictBlocks(twoBlocks)[0]!;
    const afterFirst = resolveConflictBlock(twoBlocks, first, 'ours', null);
    expect(afterFirst).toBe(['a', 'clean line', '<<<<<<< HEAD', 'c', '=======', 'd', '>>>>>>> feature'].join('\n'));

    // Re-parsed against the *new* text, as the dialog does after every accept: the
    // second block's line numbers moved once the first one's markers were removed.
    const second = parseConflictBlocks(afterFirst)[0]!;
    expect(resolveConflictBlock(afterFirst, second, 'theirs', null)).toBe(
      ['a', 'clean line', 'd'].join('\n')
    );
  });
});

describe('parseConflictBlocks: a block that is not closed', () =>
{
  /** A hand-edit passes through this state: the `=======` has been deleted. */
  const UNTERMINATED_THEN_VALID = [
    '<<<<<<< HEAD',
    'stray',
    'clean line',
    '<<<<<<< HEAD',
    'c',
    '=======',
    'd',
    '>>>>>>> feature'
  ].join('\n');

  it('skips it and still finds the well-formed block after it', () =>
  {
    const blocks = parseConflictBlocks(UNTERMINATED_THEN_VALID);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.oursLines).toEqual(['c']);
    expect(blocks[0]!.theirsLines).toEqual(['d']);
    // The block that was found is the second one, not one spanning both.
    expect(blocks[0]!.startLine).toBe(4);
    expect(blocks[0]!.endLine).toBe(8);
  });

  it('resolves that block without taking the unterminated one with it', () =>
  {
    const block = parseConflictBlocks(UNTERMINATED_THEN_VALID)[0]!;

    expect(resolveConflictBlock(UNTERMINATED_THEN_VALID, block, 'ours', null)).toBe(
      ['<<<<<<< HEAD', 'stray', 'clean line', 'c'].join('\n')
    );
  });

  it('finds nothing in a block whose `>>>>>>>` is missing', () =>
  {
    const noEnd = ['<<<<<<< HEAD', 'a', '=======', 'b', '<<<<<<< HEAD'].join('\n');

    expect(parseConflictBlocks(noEnd)).toEqual([]);
  });
});

/**
 * What guards the save, which is a blunter question than what draws the toolbars.
 *
 * A block is only parsed when all of its markers are present in order, so a half-deleted
 * one counts as nothing, and hand-editing passes through exactly that state. Counting
 * blocks would call such a file resolved and let it be staged with a marker in it.
 */
describe('hasConflictMarkers', () =>
{
  it('is false for a file with nothing left in it', () =>
  {
    expect(hasConflictMarkers(['a', 'b', 'c'].join('\n'))).toBe(false);
  });

  it('is true for a whole conflict', () =>
  {
    const text = ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature'].join('\n');

    expect(hasConflictMarkers(text)).toBe(true);
    expect(parseConflictBlocks(text)).toHaveLength(1);
  });

  /** The case the block count gets wrong: parsed as nothing, still full of markers. */
  it('is true for a block whose middle has been deleted', () =>
  {
    const text = ['<<<<<<< HEAD', 'a', 'b', '>>>>>>> feature'].join('\n');

    expect(parseConflictBlocks(text)).toHaveLength(0);
    expect(hasConflictMarkers(text)).toBe(true);
  });

  it('is true for a lone opener', () =>
  {
    const text = ['a', '<<<<<<< HEAD', 'b'].join('\n');

    expect(parseConflictBlocks(text)).toHaveLength(0);
    expect(hasConflictMarkers(text)).toBe(true);
  });

  it('is true for a lone terminator, and for a lone base marker', () =>
  {
    expect(hasConflictMarkers(['a', '>>>>>>> feature'].join('\n'))).toBe(true);
    expect(hasConflictMarkers(['a', '||||||| base'].join('\n'))).toBe(true);
  });

  /** `=======` is a real line in a document: a Markdown heading underline. */
  it('is not fooled by text that merely starts like a marker', () =>
  {
    expect(hasConflictMarkers(['Title', '=========='].join('\n'))).toBe(false);
    expect(hasConflictMarkers(['a <<<<<<< inline', 'b'].join('\n'))).toBe(false);
  });
});
