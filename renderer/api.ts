/**
 * Typed wrapper for window.git. Unwraps Vue proxies before IPC.
 */

import { toRaw } from 'vue';
import { INVOKE_CHANNELS, type GitApi } from '@shared/contract.js';

declare global
{
  interface Window {
    git: GitApi;
  }
}

/**
 * Unwrap Vue proxies before IPC (structured clone rejects them).
 * Preserves Dates, Maps, native types.
 */
function toPlain<T>(value: T): T
{
  const raw = toRaw(value);
  if (raw === null || typeof raw !== 'object')
  {
    return raw;
  }
  if (Array.isArray(raw))
  {
    return raw.map((item) => toPlain(item)) as T;
  }

  // Only recurse into plain objects. Dates, Maps, and the like clone natively and
  // would be flattened into `{}` by a blind rebuild.
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null)
  {
    return raw as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>))
  {
    out[key] = toPlain(item);
  }
  return out as T;
}

/**
 * Exported `window.git` wrapper. Every IPC call unwraps Vue proxies via toPlain().
 */
export const api: GitApi = (() =>
{
  const raw = window.git;
  const wrapped = { on: raw.on.bind(raw) } as GitApi;

  for (const channel of INVOKE_CHANNELS)
  {
    // The cast is contained here: each channel's own signature is preserved for
    // callers by GitApi, and the arguments are passed straight through.
    (wrapped as Record<string, unknown>)[channel] = (...args: unknown[]) =>
      (raw as unknown as Record<string, (...a: unknown[]) => unknown>)[channel]!(
        ...args.map((arg) => toPlain(arg))
      );
  }

  return wrapped;
})();

/**
 * A git failure that survived the IPC boundary.
 *
 * Electron prefixes the serialized message with "Error invoking remote method
 * '<channel>':", which is noise to the user; `message` here is the git stderr.
 */
export class RemoteGitError extends Error
{
  readonly raw: string;

  constructor(raw: string)
  {
    super(RemoteGitError.clean(raw));
    this.name = 'RemoteGitError';
    this.raw = raw;
  }

  private static clean(raw: string): string
  {
    return raw
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^(?:Git)?Error:\s*/, '')
      .trim();
  }
}

/** Normalize anything thrown by an `api.*` call into a displayable message. */
export function toMessage(err: unknown): string
{
  if (err instanceof Error)
  {
    return new RemoteGitError(err.message).message;
  }
  return String(err);
}
