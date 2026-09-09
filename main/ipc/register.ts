/**
 * How a handler is registered, for every handler in `main/ipc/handlers/`.
 *
 * Four ways, and never a fifth: a plain read, a read that must know which window asked,
 * a write that declares what it invalidated, and the broadcast the last of those uses.
 * Keeping them here is what stops `ipcMain.handle`'s `any` signature reaching an
 * implementation, and what makes "did this channel say what it changed?" a question with
 * one place to look.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { InvokeChannel, Invocations } from '@shared/contract.js';
import type { RepoFacet } from '@shared/invalidation.js';
import { DIAGNOSTIC_NOTE } from '@shared/types/diagnostics.js';
import { record } from '@main/diagnostics/index.js';
import { announce, beginWrite, endWrite, noteAppWrite } from './repoChanges.js';


/**
 * Register a handler with the channel's argument and return types enforced.
 * Keeps `ipcMain.handle`'s `any` signature from leaking into the implementations.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (...args: Parameters<Invocations[C]>) => Promise<ReturnType<Invocations[C]>> | ReturnType<Invocations[C]>
): void
{
  ipcMain.handle(channel, (_event, ...args) =>
    fn(...(args as Parameters<Invocations[C]>))
  );
}

/**
 * Register a handler that needs to know *which window* asked: the dialog channels
 * (which window owns a dialog, which is closing) and menu state, since two repository windows report their own.
 */
export function handleFromWindow<C extends InvokeChannel>(
  channel: C,
  fn: (
    win: BrowserWindow | null,
    ...args: Parameters<Invocations[C]>
  ) => Promise<ReturnType<Invocations[C]>> | ReturnType<Invocations[C]>
): void
{
  ipcMain.handle(channel, (event, ...args) =>
    fn(BrowserWindow.fromWebContents(event.sender), ...(args as Parameters<Invocations[C]>))
  );
}

export function broadcast(channel: string, payload: unknown): void
{
  for (const win of BrowserWindow.getAllWindows())
  {
    if (!win.isDestroyed())
    {
      win.webContents.send(channel, payload);
    }
  }
}

/**
 * Announce that a channel's work changed the repository. Every window hears it the
 * moment the work finishes, not half a second later when the `.git` watcher notices (see `./repoChanges.ts`).
 */
export function changed(repoPath: string, facets: readonly RepoFacet[]): void
{
  if (facets.length === 0)
  {
    return;
  }
  // Before the announcement: the watcher can fire while this is still being
  // coalesced, and this tells it the change is already covered.
  noteAppWrite(repoPath);
  announce(repoPath, facets, (change) =>
  {
    // The announcement, not the individual writes: what every window actually reacts to,
    // and the thing a reload storm is visible in. A checkout that announced twice was two
    // identical lines here long before anyone worked out why.
    record(DIAGNOSTIC_NOTE, `repository changed: ${change.facets.join(', ')}`);
    broadcast('event:repoChanged', change);
  });
}

/**
 * A write against `repoPath` is starting. Holds every announcement for that repository
 * until it ends, so one command of a composite operation cannot announce a repository
 * the rest of the operation has yet to move: see `announce` in `./repoChanges.ts`.
 *
 * `facets` is what the run will invalidate, and an empty set means it is a read: it
 * takes no hold, and `writeFinished` releases none. The pair turns on the same
 * condition so the two can't drift into an unbalanced count.
 */
export function writeStarted(repoPath: string, facets: readonly RepoFacet[]): void
{
  if (facets.length === 0)
  {
    return;
  }
  beginWrite(repoPath);
}

/** That write has ended, however it ended, and this is what it changed. */
export function writeFinished(repoPath: string, facets: readonly RepoFacet[]): void
{
  if (facets.length === 0)
  {
    return;
  }
  endWrite(repoPath);
  changed(repoPath, facets);
}

/**
 * Register a handler for a channel that changes the repository, declaring what it
 * invalidates: the typed channels that do their own writing rather than running an
 * argv. Announced in a `finally`, since a command that fails part-way has still changed the repository.
 */
export function handleWrite<C extends InvokeChannel>(
  channel: C,
  facets: readonly RepoFacet[],
  fn: (
    ...args: Parameters<Invocations[C]>
  ) => Promise<ReturnType<Invocations[C]>> | ReturnType<Invocations[C]>
): void
{
  ipcMain.handle(channel, async (_event, ...args) =>
  {
    // Every channel registered this way takes the repository path first.
    const repoPath = args[0] as string;
    writeStarted(repoPath, facets);
    try
    {
      return await fn(...(args as Parameters<Invocations[C]>));
    }
    finally
    {
      writeFinished(repoPath, facets);
    }
  });
}
