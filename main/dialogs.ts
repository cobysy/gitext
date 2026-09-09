/**
 * Dialog windows. Every operation dialog is its own modal `BrowserWindow`, a child of
 * the repository window it opened from: a form filled in while reading the repository
 * needs the window manager's drag/resize, not an overlay covering what you need to consult.
 *
 * A dialog raising another parents it to itself, so the stack unwinds in the order it
 * was built; `ownerWindow` walks the chain to find the repository window either way.
 * There is no result channel: the dialog runs its own git through `git:run`, broadcast to every window.
 *
 * Split by reason to change: `dialogs/ownership.ts` is the parent-chain math,
 * `dialogs/bounds.ts` is where a dialog opens. This file tracks which are open.
 */

import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from 'electron';
import { openExternalSafely } from './openExternalSafely.js';
import { join } from 'node:path';
import { MIN_DIALOG_HEIGHT, MIN_DIALOG_WIDTH } from '@shared/dialogBounds.js';
import { DIALOG_WINDOWS, type DialogName, type DialogPayload } from '@shared/dialogs.js';
import { THEME_DARK } from '@shared/types.js';
import { drivenWebPreferences, raiseWindow } from './background.js';
import { noteDialog } from './diagnostics/index.js';
import { boundsFor, rememberBounds } from './dialogs/bounds.js';
import { fitToContent, trackFit } from './dialogs/fit.js';
import {
  dialogOver,
  modalChildOf as innermostOf,
  ownerWindow as ownerOf
} from './dialogs/ownership.js';
import { isMac } from './platform.js';

export { ownerWindow, repoWindows } from './dialogs/ownership.js';

/**
 * True when `win` is a live window of ours that behaves like a dialog: it reports its
 * own height and closes itself.
 *
 * "Has a parent" is the test for every dialog, since each is a child of the window it
 * was opened from. The console starts as one too, but is detached when the form it
 * hangs from closes (see `openOutputWindow`), and from then on has no parent while
 * still needing to close itself.
 */
function isDialogWindow(win: BrowserWindow | null): win is BrowserWindow
{
  if (!win || win.isDestroyed())
  {
    return false;
  }
  return win.getParentWindow() !== null || win === outputWindow;
}

/** The renderer reporting how tall its form is. See `dialogs/fit.ts`. */
export function fitDialogWindow(sender: BrowserWindow | null, contentHeight: number): void
{
  // Only a dialog: the repository window has no business resizing itself to its content.
  if (!isDialogWindow(sender))
  {
    return;
  }
  fitToContent(sender, contentHeight);
}

// Bundled to CommonJS alongside `main/index.ts`, so this is `out/main`.
const dir = __dirname;

/**
 * The command-output console. One at a time, and deliberately outside `open`: it is
 * neither modal nor a child of the dialog that asked for it, so the dialog behind it
 * stays usable and keeps awaiting its own run, and a console the user chose to keep
 * open outlives the operation that filled it. A second run supersedes the first.
 */
let outputWindow: BrowserWindow | null = null;

/**
 * The open dialog windows, keyed by owner id and dialog name. One window per (owner,
 * dialog): invoking a command whose dialog is already open focuses it.
 */
const open = new Map<string, BrowserWindow>();

const keyFor = (owner: BrowserWindow, name: DialogName): string => `${owner.id}:${name}`;

/**
 * What each live dialog window was loaded with, so a second command opening the same
 * window can tell "the same thing again" from "a different operand".
 */
const loadedPayload = new WeakMap<BrowserWindow, string>();

/**
 * The theme a window is built and loaded in. Read once per window: the colour painted
 * before the renderer exists and the theme it starts in must be the same answer, or the
 * window changes colour as it loads.
 */
function currentTheme(): 'light' | 'dark'
{
  if (nativeTheme.shouldUseDarkColors)
  {
    return 'dark';
  }
  else
  {
    return 'light';
  }
}

/** The innermost dialog open over `owner`, if there is one. See `dialogs/ownership.ts`. */
export function modalChildOf(owner: BrowserWindow): BrowserWindow | null
{
  return innermostOf(owner, open.values());
}

/**
 * The URL a dialog window loads, with its name, payload and theme in the query string.
 * The theme travels here, not over IPC: the renderer must know it before it paints, or a dark dialog flashes white on its first frame.
 */
function loadDialog(
  win: BrowserWindow,
  name: DialogName,
  payload: DialogPayload,
  theme: 'light' | 'dark'
): void
{
  const json = JSON.stringify(payload);
  loadedPayload.set(win, json);
  const search = `?name=${encodeURIComponent(name)}&payload=${encodeURIComponent(
    json
  )}&theme=${theme}`;
  if (process.env.ELECTRON_RENDERER_URL)
  {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/dialog.html${search}`);
  }
  else
  {
    void win.loadFile(join(dir, '../renderer/dialog.html'), { search });
  }
}

/** True when `win` is a live dialog still owned by `owner` and outside the chain being kept. */
function isSiblingDialog(win: BrowserWindow, owner: BrowserWindow, chain: Set<BrowserWindow>): boolean
{
  return !win.isDestroyed() && ownerOf(win) === owner && !chain.has(win);
}

/**
 * Open a dialog window for `owner`, or focus the one already open. The payload is in
 * the query string, not a channel: arriving after mount, every dialog renders an empty form for a frame.
 */
export function openDialogWindow(
  owner: BrowserWindow,
  name: DialogName,
  payload: DialogPayload,
  /**
   * The window that asked. Decides whether this dialog *stacks* or *replaces*: see
   * below. Defaults to the owner, which is the "start fresh" reading.
   */
  openedBy: BrowserWindow = owner
): BrowserWindow
{
  const key = keyFor(owner, name);
  const existing = open.get(key);
  if (existing && !existing.isDestroyed())
  {
    // A raise takes the new payload with it. Several commands open one window and differ
    // only in what it opens on: "Manage Stashes" over an already-open Stash would
    // otherwise be the save form, which is the window the first row asked for. Only when
    // it differs: a reload throws away whatever is typed in the form.
    if (loadedPayload.get(existing) !== JSON.stringify(payload))
    {
      loadDialog(existing, name, payload, currentTheme());
    }
    noteDialog('raised', name);
    raiseWindow(existing);
    return existing;
  }

  // **Chains are allowed; strays are not.** A dialog opening another is deliberate and
  // unwinds in order (the commit screen opens Reset Changes, you come back to your
  // typed message), so everything `openedBy` hangs from survives. A dialog opened from
  // the *repository window* means "start fresh": anything else open is a stray.
  const chain = new Set<BrowserWindow>();
  for (let win: BrowserWindow | null = openedBy; win && !win.isDestroyed(); win = win.getParentWindow())
  {
    chain.add(win);
  }

  // Anything else over this owner is a *sibling*, unreachable behind a modal it didn't
  // open: closed here, since the new dialog is what was just asked for.
  for (const [otherKey, win] of [...open])
  {
    if (!isSiblingDialog(win, owner, chain))
    {
      continue;
    }
    open.delete(otherKey);
    win.close();
  }

  const spec = DIALOG_WINDOWS[name];
  const placement = boundsFor(owner, name);
  const bounds = placement.bounds;
  const theme = currentTheme();
  // Modal over whatever is actually in front: a second modal over an already-blocked window is one nobody can dismiss.
  const parent = modalChildOf(owner) ?? owner;

  // The dialog draws its own header, dragged via `-webkit-app-region: drag`; `frame:
  // false` everywhere, not just Windows/Linux: `titleBarStyle: 'hidden'` still carries
  // the `.titled` mask, whose first `show()` gets AppKit's own ~200ms zoom/fade-in that
  // Electron has no option to turn off. Borderless skips that and keeps the native shadow and rounded corners.
  const platformOptions: Partial<BrowserWindowConstructorOptions> = { frame: false };

  let backgroundColor: string;
  if (theme === THEME_DARK)
  {
    backgroundColor = '#2a2f37';
  }
  else
  {
    backgroundColor = '#ffffff';
  }

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.w,
    height: bounds.h,
    minWidth: MIN_DIALOG_WIDTH,
    minHeight: MIN_DIALOG_HEIGHT,
    title: spec.title,
    parent,
    modal: true,
    show: false,
    ...platformOptions,
    // `--bg-overlay` from `tokens.css`, duplicated as a literal since main can't read
    // the stylesheet, for the moment before the renderer draws.
    backgroundColor,
    webPreferences: {
      preload: join(dir, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...drivenWebPreferences()
    }
  });

  // A full-window dialog is a workspace, not a form to dismiss in a moment, and
  // minimizing a *modal* leaves its owner inert. No `setMaximizable`: macOS disables
  // zoom on a modal shown window regardless, and there's nothing to maximize to anyway.
  if (spec.fullWindow)
  {
    win.setMinimizable(false);
  }

  // A frameless window draws no traffic lights to begin with: `DialogFrame`'s own ✕ is
  // the close control on every platform, with nothing native to hide behind it.

  // Otherwise the application menu bar draws inside the dialog on Windows and Linux.
  if (!isMac())
  {
    win.setMenu(null);
  }

  // External links open in the real browser: a dialog window is a renderer of its own
  // with none of the repository window's setup, so an unhandled link would replace the form with a web page nobody can navigate back out of.
  win.webContents.setWindowOpenHandler(({ url }) =>
  {
    void openExternalSafely(url);
    return { action: 'deny' };
  });

  // Shown by `fit.ts`, so the fit happens off screen, not as a snap in front of you. A
  // `fullWindow` dialog reports `0` rather than a height, seeded from the owner's content height instead.
  let ownerContentHeight: number | null;
  if (spec.fullWindow)
  {
    ownerContentHeight = owner.getContentBounds().height;
  }
  else
  {
    ownerContentHeight = null;
  }
  trackFit(win, parent, placement.anchor, ownerContentHeight);
  /**
   * A dialog re-reads the working tree on focus, like the repository window: the
   * `.git` watcher misses a file an editor or build wrote, and this is when to ask again.
   */
  win.on('focus', () =>
  {
    if (!win.isDestroyed())
    {
      win.webContents.send('event:windowFocus');
    }
  });

  win.on('close', () => rememberBounds(name, win));
  win.on('closed', () =>
  {
    noteDialog('closed', name);
    if (open.get(key) === win)
    {
      open.delete(key);
    }
  });

  noteDialog('opened', name);
  open.set(key, win);
  loadDialog(win, name, payload, theme);
  return win;
}

/** Raise the command-output console over `owner`, replacing the one already up. */
export function openOutputWindow(owner: BrowserWindow, payload: DialogPayload): BrowserWindow
{
  if (outputWindow && !outputWindow.isDestroyed())
  {
    outputWindow.close();
  }

  const name: DialogName = 'commandOutput';
  const spec = DIALOG_WINDOWS[name];
  const placement = boundsFor(owner, name);
  const bounds = placement.bounds;
  const theme = currentTheme();
  let backgroundColor: string;
  if (theme === THEME_DARK)
  {
    backgroundColor = '#2a2f37';
  }
  else
  {
    backgroundColor = '#ffffff';
  }

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.w,
    height: bounds.h,
    minWidth: MIN_DIALOG_WIDTH,
    minHeight: MIN_DIALOG_HEIGHT,
    title: spec.title,
    // **A child of whatever is in front, and never modal.**
    //
    // Not modal: the console reports on a run, it does not ask anything, and blocking
    // the window that started the run would leave nobody able to answer what git asks
    // next. A child of the innermost dialog rather than of the repository window,
    // because a child window is ordered *within its parent's child stack*: parented to
    // the owner it opened underneath the modal form that started the run, which is a
    // child of that same owner.
    //
    // Not `alwaysOnTop`. That does lift it past the form, and past every other
    // application on the machine with it: a console appearing over what someone was
    // watching in another app. Ordering inside our own window stack is the whole of
    // the problem, so it is the whole of the fix. `detachFromParent` below is what
    // keeps it alive when that form closes itself.
    parent: modalChildOf(owner) ?? owner,
    modal: false,
    show: false,
    frame: false,
    backgroundColor,
    webPreferences: {
      preload: join(dir, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...drivenWebPreferences()
    }
  });

  // A modal child dies with its parent, and the form that started the run closes itself
  // the moment the run succeeds. Detached first, it outlives that: which is the point of
  // a console the reader may have chosen to keep open.
  const formParent = win.getParentWindow();
  if (formParent && formParent !== owner)
  {
    formParent.once('close', () =>
    {
      if (!win.isDestroyed())
      {
        win.setParentWindow(null);
      }
    });
  }

  if (!isMac())
  {
    win.setMenu(null);
  }

  win.webContents.setWindowOpenHandler(({ url }) =>
  {
    void openExternalSafely(url);
    return { action: 'deny' };
  });

  trackFit(win, owner, placement.anchor);
  // Focused as it appears, but **only if this app is already the one in front**.
  // `show()` alone leaves the key window where it was, and where it was is the modal
  // form that started the run: so the console would come up and still not take a
  // keystroke, including the Escape that dismisses it. Focusing it while another
  // application is frontmost is a different thing entirely, and not ours to do: a tour
  // running in the background would pull the screen away from whatever is on it.
  // `getFocusedWindow()` is null exactly when no window of ours has focus.
  win.once('show', () =>
  {
    if (BrowserWindow.getFocusedWindow())
    {
      raiseWindow(win);
    }
  });
  win.on('close', () => rememberBounds(name, win));
  win.on('closed', () =>
  {
    if (outputWindow === win)
    {
      outputWindow = null;
    }
  });

  outputWindow = win;
  loadDialog(win, name, payload, theme);
  return win;
}

/** Close the dialog window a renderer message came from. */
export function closeDialogWindow(sender: BrowserWindow | null): void
{
  // Only a child: the repository window asking to close a dialog means `repo.close`, not this.
  if (!isDialogWindow(sender))
  {
    return;
  }
  // A dialog with another standing on it waits for it: a modal child dies with its
  // parent, and the child can be the merge editor holding unsaved edits. Only the app
  // can reach this, since the child is modal and the parent's own ✕ can't be clicked;
  // every close here is one the app decided on itself.
  const child = dialogOver(sender, open.values());
  if (child)
  {
    child.once('closed', () => closeDialogWindow(sender));
    return;
  }
  // Untracked *before* it closes, not when `closed` fires: a dialog's last act can be
  // to open another (a merge ending in conflicts raises the resolver), and left in the
  // map this window would be picked as the new dialog's parent, dying with it.
  for (const [key, win] of open)
  {
    if (win === sender)
    {
      open.delete(key);
    }
  }
  sender.close();
}
