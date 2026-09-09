/**
 * Context bridge: window.git is auto-generated from the contract's channel lists,
 * so adding a channel needs no per-method boilerplate.
 */

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type Events,
  type GitApi
} from '@shared/contract.js';

const api = Object.fromEntries(
  INVOKE_CHANNELS.map((channel) => [
    channel,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  ])
) as Record<string, unknown>;

api.on = <E extends EventChannel>(channel: E, listener: (payload: Events[E]) => void) =>
{
  if (!EVENT_CHANNELS.includes(channel))
  {
    throw new Error(`Unknown event channel: ${channel}`);
  }
  const wrapped = (_event: IpcRendererEvent, payload: Events[E]): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
};

/**
 * Electron 32 removed `File.path`, so a dropped folder arrives with no way to name it
 * from the renderer. `webUtils` runs here, on the preload side of the bridge, and hands
 * back the one string the drop target needs.
 */
api.pathForFile = (file: File): string =>
{
  try
  {
    return webUtils.getPathForFile(file);
  }
  catch
  {
    // Not a real file (a dragged selection, a URL): there is no path to give.
    return '';
  }
};

contextBridge.exposeInMainWorld('git', api as unknown as GitApi);
