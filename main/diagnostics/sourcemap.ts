/**
 * Turning a renderer stack frame back into a file someone can open.
 *
 * Chromium never rewrites `error.stack` through a sourcemap: what a window reports is
 * always an offset into a bundle, `global-BC5ekBeK.js:11051:5`. That is unreadable to a
 * person and worse than unreadable to an agent, which will go looking for line 11051 of
 * a file that has 500. Main has the `.map` files beside the bundles and `node:module`'s
 * own `SourceMap`, so it resolves the frames on the way into the timeline.
 *
 * The rewriting is pure and takes the lookup as a parameter, so every frame shape below
 * is an ordinary unit test; only `fileResolver` touches the disk.
 */

import { readFileSync } from 'node:fs';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * A V8 stack frame's tail: `…/bundle.js:120:8`, with or without the wrapping parentheses
 * a named frame puts round it. Anchored at the end, since a path may contain anything.
 */
const FRAME = /^(\s*at\s+.*?)(\()?((?:file:\/\/|\/)[^\s()]+):(\d+):(\d+)(\))?$/;

/** Where a frame actually came from, once resolved. */
export type FrameLookup = (file: string, line: number, column: number) => string | null;

/**
 * Rewrite every frame the lookup can place, and leave the rest exactly as they were.
 *
 * A frame it cannot place is still evidence: a bundled offset says *something*, and
 * dropping it to hide that the lookup failed would be worse than showing it.
 */
export function resolveStack(lines: readonly string[], lookup: FrameLookup): string[]
{
  return lines.map((line) =>
  {
    const match = FRAME.exec(line);
    if (!match)
    {
      return line;
    }
    const [, prefix, open, file, lineText, columnText] = match;
    const placed = lookup(file!, Number(lineText), Number(columnText));
    if (!placed)
    {
      return line;
    }
    // The original position, and the bundle offset it came from: the second is what lets a
    // reader see a resolution that went somewhere silly, rather than trust it blindly.
    const where = `${placed}  [${file!.split('/').pop()}:${lineText}]`;
    if (open)
    {
      return `${prefix}(${where})`;
    }
    return `${prefix}${where}`;
  });
}

/** A map, and how many generated lines it actually covers. */
interface LoadedMap {
  map: SourceMap;
  /**
   * Lines the bundle has, counted off the payload's own `mappings`, which is one
   * `;`-separated group per generated line.
   *
   * `findEntry` answers a line past the end with the nearest preceding mapping rather
   * than nothing, so without this bound a frame from *another build* resolves to a
   * confident, wrong file. A wrong answer is worse than no answer: it sends whoever is
   * reading, person or agent, to a function that was never involved.
   */
  lines: number;
}

/** Loaded maps, by bundle path: a stack is a dozen frames into two or three files. */
const maps = new Map<string, LoadedMap | null>();

function mapFor(jsPath: string): LoadedMap | null
{
  const cached = maps.get(jsPath);
  if (cached !== undefined)
  {
    return cached;
  }
  let loaded: LoadedMap | null;
  try
  {
    const payload = JSON.parse(readFileSync(`${jsPath}.map`, 'utf8')) as SourceMapPayload;
    loaded = {
      map: new SourceMap(payload),
      lines: payload.mappings.split(';').length
    };
  }
  catch
  {
    // No map beside the bundle: a development run, or a build without them. Not an error.
    loaded = null;
  }
  maps.set(jsPath, loaded);
  return loaded;
}

/**
 * The real lookup: find the map beside the bundle and ask it.
 *
 * `SourceMap` is zero-based on both axes and V8 stacks are one-based, so both numbers are
 * decremented going in and the line is incremented coming out. Getting that wrong is a
 * report that points one line off, which is the kind of wrong nobody notices.
 */
export const fileResolver: FrameLookup = (file, line, column) =>
{
  let jsPath: string;
  try
  {
    if (file.startsWith('file://'))
    {
      jsPath = fileURLToPath(file);
    }
    else
    {
      jsPath = file;
    }
  }
  catch
  {
    return null;
  }

  const loaded = mapFor(jsPath);
  if (!loaded || line > loaded.lines)
  {
    return null;
  }
  // `findEntry` is typed as returning `{}` when it places nothing, so the shape is
  // narrowed here rather than trusted.
  const entry = loaded.map.findEntry(line - 1, column - 1) as Partial<{
    originalSource: string;
    originalLine: number;
    originalColumn: number;
  }>;
  if (
    entry.originalSource === undefined
    || entry.originalLine === undefined
    || entry.originalColumn === undefined
  )
  {
    return null;
  }
  // Rollup writes these relative to the chunk, with `../` hops out of `out/`; the tail is
  // the part that names a file in this repository.
  const source = entry.originalSource.replace(/^.*?(?=(?:renderer|main|shared)\/)/, '');

  return `${source}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
};
