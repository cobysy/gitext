/**
 * Submodules: declared paths and whether they are initialized.
 * Not using `git submodule status` (walks every submodule, slow on every tick);
 * status badges fetch the specific one when needed instead.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { SubmoduleEntry, SubmoduleStatusEntry } from '@shared/types.js';
import { parseSubmoduleConfig, parseSubmoduleStatus } from './parse.js';
import { GIT_KIND_READ, tryGit } from './runner.js';

const CMD_CONFIG = 'config';
const CMD_SUBMODULE = 'submodule';
const SUBCOMMAND_STATUS = 'status';
const FLAG_FILE = '-f';
const FLAG_NUL_TERMINATED = '--null';
const FLAG_LIST = '--list';
const GITMODULES_FILE = '.gitmodules';

export function buildSubmoduleListArgs(): string[]
{
  return [CMD_CONFIG, FLAG_FILE, GITMODULES_FILE, FLAG_NUL_TERMINATED, FLAG_LIST];
}

export async function listSubmodules(repoPath: string): Promise<SubmoduleEntry[]>
{
  // No `.gitmodules` is the common case, and git exits non-zero for it.
  const out = await tryGit(repoPath, buildSubmoduleListArgs());
  if (!out)
  {
    return [];
  }

  return parseSubmoduleConfig(out).map((entry) => ({
    ...entry,
    // Check disk instead of spawning into each submodule.
    initialized: existsSync(join(resolveIn(repoPath, entry.path), '.git'))
  }));
}

/** `.gitmodules` paths are repo-relative, but tolerate an absolute one. */
function resolveIn(repoPath: string, path: string): string
{
  if (isAbsolute(path))
  {
    return path;
  }
  else
  {
    return join(repoPath, path);
  }
}

export function buildSubmoduleStatusArgs(): string[]
{
  return [CMD_SUBMODULE, SUBCOMMAND_STATUS];
}

/** Walks every submodule to report state (expensive, used by manage dialog only, not on watcher tick). */
export async function submoduleStatus(repoPath: string): Promise<SubmoduleStatusEntry[]>
{
  const out = await tryGit(repoPath, buildSubmoduleStatusArgs(), { kind: GIT_KIND_READ });
  if (out)
  {
    return parseSubmoduleStatus(out);
  }
  else
  {
    return [];
  }
}
