/**
 * Every hand-written file in the repository, for the tests that read the source as text.
 *
 * Two of them do: one checks that no file carries a raw control character, the other that
 * none carries an em dash. Neither is about what the code *does*, so both walk the tree
 * rather than importing anything, and the walk is here so it is written once.
 */

import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');

/**
 * Directories with nothing hand-written in them. `.serena` is a code index and the notes
 * its server writes for itself: gitignored, machine-written, and held to none of the
 * prose rules these two tests enforce on the source.
 */
const SKIP = new Set(['.git', '.serena', 'node_modules', 'out', 'dist', 'coverage']);

const SOURCE = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.json',
  '.css',
  '.html',
  '.md'
]);

export function sourceFiles(dir: string = ROOT, into: string[] = []): string[]
{
  for (const entry of readdirSync(dir))
  {
    if (SKIP.has(entry))
    {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory())
    {
      sourceFiles(path, into);
    }
    else if (SOURCE.has(extname(entry)))
    {
      into.push(path);
    }
  }
  return into;
}
