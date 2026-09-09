/**
 * Repository windows. Split from main/index.ts so IPC can open window
 * without circular import.
 */

import { BrowserWindow, nativeTheme } from 'electron';
import { openExternalSafely } from './openExternalSafely.js';
import { join } from 'node:path';
import { drivenWebPreferences, showWindow } from './background.js';
import { isMac } from './platform.js';

// Bundled to CommonJS as out/main.
const dir = __dirname;

const TITLE_BAR_STYLE_HIDDEN_INSET = 'hiddenInset';
const TITLE_BAR_STYLE_DEFAULT = 'default';
const WINDOW_BG_DARK = '#1e2127';
const WINDOW_BG_LIGHT = '#ffffff';
const EVENT_WINDOW_FOCUS = 'event:windowFocus';

/**
 * Repository window. startPath opens on a repo rather than last open.
 * Query parameter so renderer has it before mounting.
 */
export function createWindow(startPath?: string): BrowserWindow
{
  // Frameless on macOS for custom title bar (repo switcher).
  let titleBarStyle: string;
  if (isMac())
  {
    titleBarStyle = TITLE_BAR_STYLE_HIDDEN_INSET;
  }
  else
  {
    titleBarStyle = TITLE_BAR_STYLE_DEFAULT;
  }
  let backgroundColor: string;
  if (nativeTheme.shouldUseDarkColors)
  {
    backgroundColor = WINDOW_BG_DARK;
  }
  else
  {
    backgroundColor = WINDOW_BG_LIGHT;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: titleBarStyle as 'hiddenInset' | 'default',
    backgroundColor,
    webPreferences: {
      preload: join(dir, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...drivenWebPreferences()
    }
  });

  win.once('ready-to-show', () => showWindow(win));

  // Window focus cues re-read working tree: file watcher watches .git only.
  // Sent from here, not DOM event (unreliable).
  win.on('focus', () =>
  {
    if (!win.isDestroyed())
    {
      win.webContents.send(EVENT_WINDOW_FOCUS);
    }
  });

  // External links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) =>
  {
    void openExternalSafely(url);
    return { action: 'deny' };
  });

  let query;
  if (startPath)
  {
    query = { repo: startPath };
  }
  else
  {
    query = undefined;
  }
  if (process.env.ELECTRON_RENDERER_URL)
  {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (startPath)
    {
      url.searchParams.set('repo', startPath);
    }
    void win.loadURL(url.toString());
  }
  else
  {
    void win.loadFile(join(dir, '../renderer/index.html'), { query });
  }

  return win;
}
