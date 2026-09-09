/**
 * Showing a path in Finder.
 *
 * `shell.showItemInFolder` selects the file and leaves Finder behind the window that
 * asked, so nothing moves on screen and the row reads as doing nothing at all. `open -R`
 * activates the application it hands the path to, which is what the row promises. That
 * difference is invisible to a type checker and to every other test here, so it is
 * pinned as the argv.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promisify } from 'node:util';

const promisifyCustom = promisify.custom;

/** A path that exists, so the stat before `open` passes: this file itself. */
const REAL_PATH = new URL(import.meta.url).pathname;

const opened: unknown[][] = [];
const shownInFolder: string[] = [];
let mac = true;

/**
 * `execFile` is reached through `promisify`, so the mock has to carry the symbol
 * `promisify` looks for: without it the promisified call resolves through the callback
 * shim and never runs this at all.
 */
vi.mock('node:child_process', async (importOriginal) =>
{
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFile = (...args: unknown[]): unknown =>
  {
    opened.push(args);
    return undefined;
  };
  Object.defineProperty(execFile, promisifyCustom, {
    value: (...args: unknown[]) =>
    {
      opened.push(args);
      return Promise.resolve({ stdout: '', stderr: '' });
    }
  });
  return { ...actual, execFile };
});

// The module imports Electron at load time, and Electron cannot be loaded under Node.
vi.mock('electron', () => ({
  dialog: {},
  shell: { showItemInFolder: (path: string) => shownInFolder.push(path) }
}));

vi.mock('@main/platform.js', () => ({
  isMac: () => mac,
  isWindows: () => false
}));

vi.mock('@main/settings.js', () => ({ getSettings: () => ({}) }));

const { revealInFinder } = await import('@main/externalOpen.js');

describe('revealInFinder', () =>
{
  beforeEach(() =>
  {
    opened.length = 0;
    shownInFolder.length = 0;
    mac = true;
  });

  it('reveals the path with `open -R`, which brings Finder forward', async () =>
  {
    await revealInFinder(REAL_PATH);
    expect(opened[0]?.slice(0, 2)).toEqual(['/usr/bin/open', ['-R', REAL_PATH]]);
    expect(shownInFolder).toEqual([]);
  });

  it('says so, rather than going quiet, when the path is not on disk', async () =>
  {
    // The everyday case: a file list's rows are what a *commit* held, so reading history
    // routinely names a path this branch does not have. `open` exits non-zero and the
    // click used to look ignored.
    await expect(revealInFinder('/work/app/gone.ts')).rejects.toThrow(
      'There is no `gone.ts` on disk to show.'
    );
    expect(opened).toEqual([]);
  });

  it('falls back to the Electron call where there is no `open`', async () =>
  {
    mac = false;
    await revealInFinder('/work/app/src/main.ts');
    expect(opened).toEqual([]);
    expect(shownInFolder).toEqual(['/work/app/src/main.ts']);
  });
});
