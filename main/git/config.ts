/**
 * Read/write git config in a named scope (identity and tools from one source of truth).
 */

import { homedir } from 'node:os';
import { CONFIG_SCOPE_EFFECTIVE, type ConfigScope, type ConfigWriteScope } from '@shared/types.js';
import { GIT_KIND_READ, runGit, tryGit } from './runner.js';

const CMD_CONFIG = 'config';
const FLAG_GET = '--get';
const FLAG_UNSET = '--unset';

/** `effective` passes no scope flag at all, which is exactly what asks git to resolve. */
function scopeFlags(scope: ConfigScope): string[]
{
  if (scope === CONFIG_SCOPE_EFFECTIVE)
  {
    return [];
  }
  else
  {
    return [`--${scope}`];
  }
}

export function buildConfigReadArgs(scope: ConfigScope, key: string): string[]
{
  return [CMD_CONFIG, ...scopeFlags(scope), FLAG_GET, key];
}

/**
 * `null` unsets the key; anything else sets it.
 *
 * `--unset` rather than writing an empty string: for `core.autocrlf` an empty value is a
 * value git parses and complains about, while unset is the state the field started in.
 */
export function buildConfigWriteArgs(
  scope: ConfigWriteScope,
  key: string,
  value: string | null
): string[]
{
  if (value === null)
  {
    return [CMD_CONFIG, ...scopeFlags(scope), FLAG_UNSET, key];
  }
  else
  {
    return [CMD_CONFIG, ...scopeFlags(scope), key, value];
  }
}

/**
 * Where git runs when the question is not about a repository.
 *
 * `--global` is answerable with no repository open at all, which is the case this exists
 * for: the first-run health check says `user.name` is unset before any repository has been
 * opened, and its Fix button has to lead somewhere that works. Home is resolved here rather
 * than passed in, so the path never crosses the IPC boundary.
 */
function cwdFor(repoPath: string | null): string
{
  return repoPath ?? homedir();
}

/**
 * Config values in one scope, as `getConfigValues` does for the effective one.
 *
 * A key that is not set in that scope comes back missing rather than empty: the caller
 * shows what would be inherited instead, and cannot do that if unset and empty look alike.
 */
export async function readConfigValues(
  repoPath: string | null,
  scope: ConfigScope,
  keys: string[]
): Promise<Record<string, string>>
{
  const cwd = cwdFor(repoPath);
  const entries = await Promise.all(
    keys.map(async (key) =>
    {
      const value = await tryGit(cwd, buildConfigReadArgs(scope, key), { kind: GIT_KIND_READ });
      return [key, value?.trim() ?? null] as const;
    })
  );

  const result: Record<string, string> = {};
  for (const [key, value] of entries)
  {
    if (value !== null)
    {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Set or unset one key.
 *
 * The two halves fail differently on purpose. A set that git refuses: an invalid key
 * name, a read-only file, is an error the form has to show. An unset of a key that was
 * not there exits 5, and the state it was asked for is already the state on disk, so
 * `tryGit` swallowing it is the right answer rather than an error about a no-op.
 */
export async function writeConfigValue(
  repoPath: string | null,
  scope: ConfigWriteScope,
  key: string,
  value: string | null
): Promise<void>
{
  const cwd = cwdFor(repoPath);
  const argv = buildConfigWriteArgs(scope, key, value);
  if (value === null)
  {
    await tryGit(cwd, argv);
    return;
  }
  await runGit(cwd, argv);
}
