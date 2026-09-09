/**
 * Putting a renderer stack frame back on a file someone can open.
 *
 * Chromium hands a window an offset into a bundle and nothing else, so this is the step
 * between a report saying `global-BC5ekBeK.js:11051:5` and it saying
 * `renderer/model/graph/revisionGraph.ts:457`. Worth testing closely: a rewrite that is
 * one line out is the kind of wrong nobody notices until they have read the wrong
 * function twice.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileResolver, resolveStack, type FrameLookup } from '@main/diagnostics/sourcemap.js';

/** Places everything, so the tests below are about the rewriting rather than the lookup. */
const always: FrameLookup = (_file, line, column) => `src/thing.ts:${line}:${column}`;

/** Places nothing: the other half of every rewrite decision. */
const never: FrameLookup = () => null;

describe('rewriting a stack', () =>
{
  it('rewrites a named frame, keeping the function name', () =>
  {
    const [out] = resolveStack(
      ['at useGridInteraction (file:///app/out/renderer/assets/global-A.js:11051:5)'],
      always
    );
    expect(out).toContain('at useGridInteraction (');
    expect(out).toContain('src/thing.ts:11051:5');
  });

  it('rewrites an anonymous frame, which has no parentheses', () =>
  {
    const [out] = resolveStack(['at file:///app/out/renderer/assets/index-B.js:120:3'], always);
    expect(out).toContain('src/thing.ts:120:3');
  });

  /** The bundle offset is what makes a wrong resolution visible rather than confusing. */
  it('keeps the bundle offset it came from', () =>
  {
    const [out] = resolveStack(
      ['at f (file:///app/out/renderer/assets/global-A.js:11051:5)'],
      always
    );
    expect(out).toContain('[global-A.js:11051]');
  });

  it('leaves a frame it cannot place exactly as it was', () =>
  {
    const line = 'at f (file:///app/out/renderer/assets/global-A.js:11051:5)';
    expect(resolveStack([line], never)).toEqual([line]);
  });

  it('leaves the message line and anything else alone', () =>
  {
    const lines = ['TypeError: x is not a function', 'at f (file:///a/b.js:1:1)'];
    expect(resolveStack(lines, never)).toEqual(lines);
  });

  it('handles a stack with nothing in it', () =>
  {
    expect(resolveStack([], always)).toEqual([]);
  });
});

/**
 * Against the real build rather than a fixture, because the thing that breaks is the
 * agreement between rollup's output and Node's reader, and a fixture would agree with
 * whatever this file assumed on the day it was written. Skipped when nothing is built.
 */
const ASSETS = join(process.cwd(), 'out/renderer/assets');
const built = existsSync(ASSETS) && readdirSync(ASSETS).some((f) => f.endsWith('.js.map'));

describe.skipIf(!built)('against the real build', () =>
{
  function biggestBundle(): string
  {
    const maps = readdirSync(ASSETS).filter((f) => f.startsWith('global-') && f.endsWith('.js.map'));
    return join(ASSETS, maps[0]!.replace(/\.map$/, ''));
  }

  /**
   * A frame from the middle of the bundle, found rather than written down.
   *
   * A fixed line number is a claim about how long the bundle is, and the bundle's length
   * is a build decision: splitting a chunk out of it turned a frame in the middle into
   * one past the end, and the test failed for a reason that had nothing to do with the
   * reader. Not every line carries a mapping, so this walks forward from the middle to
   * the first that does: a resolver that answered nothing at all would still fail here.
   */
  it('places a frame in this repository, one-based as a stack is', () =>
  {
    const bundle = biggestBundle();
    const lines = readFileSync(bundle, 'utf8').split('\n').length;
    const ours = /^(renderer|shared|main)\/.+\.(ts|vue):(\d+):\d+$/;
    let placed: string | null = null;
    for (let line = 1; line <= lines && placed === null; line++)
    {
      const at = fileResolver(bundle, line, 6);
      if (at !== null && ours.test(at))
      {
        placed = at;
      }
    }

    expect(placed, 'no frame in the bundle resolved into this repository').not.toBeNull();
    const [, , , sourceLine] = ours.exec(placed!)!;
    // One-based, as a stack is: a zero here is the reader handing on the map's own
    // numbering, which is off by one against every frame it will ever be asked about.
    expect(Number(sourceLine)).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(process.cwd(), placed!.replace(/:\d+:\d+$/, '')))).toBe(true);
  });

  /**
   * `findEntry` answers a line past the end with the nearest preceding mapping, so
   * without a bound a stack from another build resolves to a confident, wrong file.
   */
  it('says nothing for an offset past the end of the bundle', () =>
  {
    expect(fileResolver(biggestBundle(), 9_000_000, 1)).toBeNull();
  });

  it('says nothing when there is no map beside the file', () =>
  {
    expect(fileResolver(join(ASSETS, 'no-such-bundle.js'), 1, 1)).toBeNull();
  });
});
