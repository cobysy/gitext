/**
 * How main pushes an event to one window: the payload checked against `Events`, and
 * nothing sent once the window has closed. Every per-window `webContents.send` goes
 * through here rather than being written out again.
 */

import type { BrowserWindow } from 'electron';
import type { EventChannel, Events } from '@shared/contract.js';

export function sendTo<E extends EventChannel>(
  win: BrowserWindow | null,
  channel: E,
  payload: Events[E]
): void
{
  if (win && !win.isDestroyed())
  {
    win.webContents.send(channel, payload);
  }
}
