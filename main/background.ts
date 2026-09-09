/**
 * Launching without taking the screen. The driver and tours launch this app to *read*
 * it, and on macOS a launch takes the machine, so `GITEXT_BACKGROUND=1` says this process
 * is being driven, not used, and its windows are created as always but never shown.
 * Playwright drives them over the DevTools protocol, which talks to the renderer rather
 * than the window server. Never shown, not `showInactive()`: macOS silently ignores that
 * for a *modal child*, every dialog here. `drivenWebPreferences` turns off Chromium's
 * background throttling, since a driver waiting on a paused animation is the flakiest
 * failure there is. Not a setting: a real run could get stuck with a setting.
 */

import { app, type BrowserWindow, type WebPreferences } from 'electron';

/** Launched to be driven, not used. */
export const backgroundLaunch = process.env.GITEXT_BACKGROUND === '1';

/** Keep the app out of the Dock, before any window exists: hidden windows alone would still leave a bouncing Dock icon. */
export function applyBackgroundLaunch(): void
{
  if (!backgroundLaunch)
  {
    return;
  }
  void app.dock?.hide();
}

/** The `webPreferences` a driven run needs, to spread into a window's own. Empty in a normal run: throttling a window nobody is looking at is the right default. */
export function drivenWebPreferences(): Partial<WebPreferences>
{
  if (backgroundLaunch)
  {
    return { backgroundThrottling: false };
  }
  else
  {
    return {};
  }
}

/** Show a window, or leave it off screen when this run is being driven. Every caller is a *reveal*: the point a window built hidden becomes visible. */
export function showWindow(win: BrowserWindow): void
{
  if (win.isDestroyed() || backgroundLaunch)
  {
    return;
  }
  win.show();
}

/** Raise a window that already exists: reopening a still-open dialog. A no-op in the background: the window is still there and driveable, it just doesn't jump. */
export function raiseWindow(win: BrowserWindow): void
{
  if (win.isDestroyed() || backgroundLaunch)
  {
    return;
  }
  win.focus();
}
