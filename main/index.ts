/**
 * Main process entry point: app lifecycle and menu. Windows are in windows.ts to
 * avoid circular imports with the IPC layer.
 */

import { app, BrowserWindow, nativeTheme } from 'electron';
import { DEFAULT_SETTINGS, THEME_DARK, THEME_LIGHT } from '@shared/types.js';
import { applyBackgroundLaunch } from './background.js';
import {
  noteError,
  noteSession,
  noteSettings,
  watchGitCommands,
  writeCrashReport
} from './diagnostics/index.js';
import { resolveGit } from './git/env.js';
import { setCommandLogDepth } from './git/runner.js';
import { registerIpcHandlers } from './ipc/index.js';
import { installMenu } from './menu.js';
import { loadSettings, getSettings, pruneRecentRepos } from './settings.js';
import { closeAllWatchers } from './watcher.js';
import { createWindow } from './windows.js';

const EVENT_THEME = 'event:theme';

function broadcastTheme(): void
{
  let theme;
  if (nativeTheme.shouldUseDarkColors)
  {
    theme = THEME_DARK;
  }
  else
  {
    theme = THEME_LIGHT;
  }
  for (const win of BrowserWindow.getAllWindows())
  {
    if (!win.isDestroyed())
    {
      win.webContents.send(EVENT_THEME, theme);
    }
  }
}

/**
 * Catch what would otherwise leave nothing behind.
 *
 * An unhandled throw in main takes the app down with no window left to press "Save
 * Diagnostics…", which is the one moment the timeline is worth the most and the one
 * moment an in-memory ring cannot survive. Both handlers write the ring out and then get
 * out of the way: an `uncaughtException` handler that swallows the error turns a crash
 * into a hang, which is worse than the crash.
 */
function installCrashCapture(): void
{
  // Rewrites `error.stack` through the build's sourcemaps, so a main-process frame reads
  // `main/git/runner.ts:412` rather than an offset into a bundle nobody can open.
  process.setSourceMapsEnabled(true);

  process.on('uncaughtException', (error: Error) =>
  {
    noteError('main process', error.message, error.stack);
    const file = writeCrashReport(getSettings().redactDiagnostics);
    console.error('Uncaught exception:', error);
    if (file)
    {
      console.error(`Diagnostics written to ${file}`);
    }
  });

  process.on('unhandledRejection', (reason: unknown) =>
  {
    let message: string;
    let stack: string | undefined;
    if (reason instanceof Error)
    {
      message = reason.message;
      stack = reason.stack;
    }
    else
    {
      message = String(reason);
    }
    noteError('main process', message, stack);
    console.error('Unhandled rejection:', reason);
  });
}

void app.whenReady().then(async () =>
{
  // A run being driven must not come to the front: see background.ts.
  applyBackgroundLaunch();

  loadSettings();
  // Once, at startup: repositories that have been deleted or live on an unmounted volume
  // should not be offered on the welcome screen, and the same directory reached through
  // `/var` and `/private/var` should not appear twice.
  const settings = pruneRecentRepos();
  setCommandLogDepth(settings.commandLogDepth);
  nativeTheme.themeSource = settings.theme;

  // Before anything else runs a command: the timeline is only worth reading if it
  // starts at the beginning.
  watchGitCommands();
  installCrashCapture();

  const git = await resolveGit(settings.gitPath);
  noteSession(git.version?.raw ?? `git not found: ${git.error ?? 'unknown'}`);
  noteSettings(settings, DEFAULT_SETTINGS);

  registerIpcHandlers();
  installMenu();

  nativeTheme.on('updated', broadcastTheme);

  createWindow();

  app.on('activate', () =>
  {
    if (BrowserWindow.getAllWindows().length === 0)
    {
      createWindow();
    }
  });
});

app.on('window-all-closed', () =>
{
  // Standard macOS keeps apps resident, but a GUI with no window is confusing.
  closeAllWatchers();
  app.quit();
});

app.on('before-quit', closeAllWatchers);

export { getSettings };
