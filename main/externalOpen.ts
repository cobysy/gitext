/**
 * Hand a revision's file to external programs. Extract to temp path (git object to disk), pick app for "open with".
 */

import { execFile, spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dialog, shell } from 'electron';
import { ENDPOINT_KIND_COMMIT, type DiffEndpoint } from '@shared/diff.js';
import { readFileAt } from '@main/git/file.js';
import { isMac, isWindows } from '@main/platform.js';
import { getSettings } from '@main/settings.js';

const run = promisify(execFile);

const OPEN_BIN = '/usr/bin/open';
const FLAG_APPLICATION = '-a';
const FLAG_REVEAL = '-R';
const FLAG_BUNDLE_ID = '-b';
const ITERM_BUNDLE_ID = 'com.googlecode.iterm2';
const TERMINAL_APP = 'Terminal';

/**
 * A file as of some revision, written where another program can open it.
 *
 * The temp name keeps the basename so whatever opens it picks the right application:
 * and so a difftool's two panes are labelled with the file rather than with a hash. It
 * is prefixed with the revision key because comparing a file against itself at another
 * revision would otherwise write both ends to the same path.
 */
export async function writeTempCopy(
  repoPath: string,
  endpoint: DiffEndpoint,
  path: string
): Promise<string>
{
  const contents = await readFileAt(repoPath, endpoint, path);
  let at;
  if (endpoint.kind === ENDPOINT_KIND_COMMIT)
  {
    at = endpoint.sha.slice(0, 7);
  }
  else
  {
    at = endpoint.kind;
  }
  const target = join(tmpdir(), `gitext-${at}-${Date.now()}-${basename(path)}`);
  await writeFile(target, contents);
  return target;
}

/**
 * Hand a file to an application the user picks, rather than to the default one.
 *
 * There is no cross-platform "open with": the two platforms disagree about whether it
 * is a shell verb or a question you ask the user: so each gets what it actually has.
 * Windows has the dialog built into the shell. macOS has none, so the applications
 * folder is offered as a file picker and the chosen bundle is handed `open -a`, which is
 * the same thing the Finder does. Anywhere else, the default application: a file that
 * opens is better than an error about a platform.
 */
export async function openWith(nativePath: string): Promise<void>
{
  if (isWindows())
  {
    // Detached, and its output ignored: the dialog outlives this call by design.
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', nativePath], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    return;
  }

  if (!isMac())
  {
    await shell.openPath(nativePath);
    return;
  }

  const picked = await dialog.showOpenDialog({
    title: 'Open With',
    defaultPath: '/Applications',
    filters: [{ name: 'Applications', extensions: ['app'] }],
    properties: ['openFile']
  });
  const application = picked.filePaths[0];
  if (picked.canceled || !application)
  {
    return;
  }
  spawn(OPEN_BIN, [FLAG_APPLICATION, application, nativePath], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

/**
 * Open a terminal with `directory` as its working directory.
 *
 * Awaited rather than detached like `openWith` above, because this one has to know whether
 * it worked in order to try the next candidate. That costs nothing: `open` returns as soon
 * as the launch is handed to the window server, not when the application is ready.
 *
 * The configured application is tried first, then iTerm2 **by bundle id**: stable whether
 * the bundle is called iTerm or iTerm2 and wherever it was installed, which its name is
 * not: then Terminal, which ships with the OS and is the reason the list ends there.
 */
export async function openTerminal(directory: string): Promise<void>
{
  const configured = getSettings().terminalApp?.trim();
  const candidates: string[][] = [];
  if (configured)
  {
    candidates.push([FLAG_APPLICATION, configured]);
  }
  candidates.push([FLAG_BUNDLE_ID, ITERM_BUNDLE_ID], [FLAG_APPLICATION, TERMINAL_APP]);

  for (const candidate of candidates)
  {
    try
    {
      await run(OPEN_BIN, [...candidate, directory]);
      return;
    }
    catch
    {
      // Not installed, or refused the file. Try the next one; the last failure is the
      // one that gets reported.
    }
  }

  let message: string;
  if (configured)
  {
    message = `Could not open ${configured}, iTerm or Terminal. Check the terminal application in Settings.`;
  }
  else
  {
    message = 'Could not open iTerm or Terminal.';
  }
  throw new Error(message);
}

/**
 * Show a path in Finder, selected inside its enclosing folder.
 *
 * `open -R` rather than `shell.showItemInFolder`, which selects the file and then leaves
 * Finder behind this window: nothing moves on screen, so the row reads as broken. `open`
 * activates the application it hands the file to, which is what "show it to me" means.
 *
 * Awaited rather than detached, like `openTerminal`, because the path is the caller's
 * guess and is often wrong: a file list's rows are what a *commit* held, so a row read
 * through history names something since renamed, deleted, or never checked out on this
 * branch. `open` answers that with a non-zero exit and a line on stderr, and thrown away
 * it looks exactly like the app ignoring the click. The stat is what turns that into a
 * sentence worth reading; anything else `open` refuses is reported in its own words. Off
 * macOS there is no `open`, and the Electron call is what the platform has.
 */
export async function revealInFinder(nativePath: string): Promise<void>
{
  if (!isMac())
  {
    shell.showItemInFolder(nativePath);
    return;
  }

  try
  {
    await stat(nativePath);
  }
  catch
  {
    throw new Error(`There is no \`${basename(nativePath)}\` on disk to show.`);
  }

  await run(OPEN_BIN, [FLAG_REVEAL, nativePath]);
}
