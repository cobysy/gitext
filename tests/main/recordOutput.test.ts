/**
 * What a record keeps of the lines it was handed: see `main/git/runner/recordOutput.ts`.
 * Shaping those lines is `terminalLine`'s job, and is tested in `ptyOutput.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { MAX_RECORD_OUTPUT } from '@shared/types.js';
import { CappedOutput } from '@main/git/runner/recordOutput.js';

describe('CappedOutput', () =>
{
  it('keeps the lines it was given, each ended', () =>
  {
    const out = new CappedOutput();
    out.addLine('first');
    out.addLine('second');
    expect(out.kept).toBe('first\nsecond\n');
    expect(out.cutFrom).toBeUndefined();
  });

  it('shows the line still being written, and drops it once it ends', () =>
  {
    const out = new CappedOutput();
    out.addLine('done');
    out.setPartial('Receiving objects:  50%');
    expect(out.kept).toBe('done\nReceiving objects:  50%');

    // The line ended: it arrives as a line, and there is nothing part-written after it.
    out.addLine('Receiving objects: 100%, done.');
    out.setPartial('');
    expect(out.kept).toBe('done\nReceiving objects: 100%, done.\n');
  });

  it('stops at the cap and says how much there was', () =>
  {
    const out = new CappedOutput();
    const line = 'x'.repeat(99);
    const ended = `${line}\n`;
    const lines = Math.ceil(MAX_RECORD_OUTPUT / ended.length) + 10;
    for (let i = 0; i < lines; i += 1)
    {
      out.addLine(line);
    }
    expect(out.kept).toHaveLength(MAX_RECORD_OUTPUT);
    expect(out.kept).toBe(ended.repeat(lines).slice(0, MAX_RECORD_OUTPUT));
    expect(out.cutFrom).toBe(ended.length * lines);
  });

  it('counts the unfinished line towards what was cut', () =>
  {
    const out = new CappedOutput();
    out.addLine('x'.repeat(MAX_RECORD_OUTPUT));
    out.setPartial('and more');
    expect(out.kept).toHaveLength(MAX_RECORD_OUTPUT);
    expect(out.cutFrom).toBe(MAX_RECORD_OUTPUT + 1 + 'and more'.length);
  });
});
