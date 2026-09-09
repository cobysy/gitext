/**
 * A progress meter reaches the renderer while it is still moving.
 *
 * `git push --progress` spends a whole phase rewriting one line with `\r` and no
 * newline in it. A splitter that only knows `\n` holds all of that until the phase
 * ends, so the window showed nothing and then showed every tick run together on one
 * line. What is pinned here is the other half of the fix: the line still being written
 * is reported as it changes, and reads as its latest tick rather than all of them.
 *
 * Against a real spawn, with `gitPath` pointed at a script that writes what git writes:
 * the behaviour lives in `execute`'s pump, and a fake would be testing the fake.
 */

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getGitPath, setGitPath, streamGit } from '@main/git/runner.js';

let root = '';
let realGit = '';

/** Ticks with no newline, a pause, then the line finally ends. */
const SCRIPT = `#!/bin/sh
printf 'Counting objects:   0%% (1/402)\\rCounting objects:  50%% (201/402)'
sleep 0.4
printf '\\rCounting objects: 100%% (402/402), done.\\n'
`;

beforeAll(async () =>
{
  root = await mkdtemp(join(tmpdir(), 'gitext-partial-'));
  const script = join(root, 'fake-git');
  await writeFile(script, SCRIPT);
  await chmod(script, 0o755);
  realGit = getGitPath();
  setGitPath(script);
});

afterAll(async () =>
{
  setGitPath(realGit);
  await rm(root, { recursive: true, force: true });
});

it('reports the line still being written, before the newline that ends it', async () =>
{
  const lines: string[] = [];
  const partials: string[] = [];
  /** What had been reported by the time the ticking line was still unfinished. */
  let partialsBeforeAnyLine = 0;

  const { done } = streamGit(
    root,
    ['progress'],
    (line) => lines.push(line),
    {},
    (partial) =>
    {
      partials.push(partial);
      if (lines.length === 0)
      {
        partialsBeforeAnyLine += 1;
      }
    }
  );
  await done;

  // The point: something arrived while the phase was still running, rather than
  // everything arriving at the end.
  expect(partialsBeforeAnyLine).toBeGreaterThan(0);
  // And what arrived was the latest tick, not every tick it had passed through.
  expect(partials[0]).toBe('Counting objects:  50% (201/402)');
  expect(partials[0]).not.toContain('\r');

  // The finished line lands once, collapsed the same way.
  expect(lines).toEqual(['Counting objects: 100% (402/402), done.']);
});
