/** Platform detection (main process counterpart to renderer/keys.ts). */

export function isMac(): boolean
{
  return process.platform === 'darwin';
}

export function isWindows(): boolean
{
  return process.platform === 'win32';
}
