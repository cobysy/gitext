/**
 * Locate git binary. Sanity check (version, identity config) is separate
 * in health.ts.
 */

import { access, constants } from 'node:fs/promises';
import { platform } from 'node:os';
import type { GitEnvironment } from '@shared/types.js';
import { parseGitVersion } from './parse.js';
import { GIT_KIND_READ, getGitPath, runGit, setGitPath } from './runner.js';

/** Fallback locations checked when `git` is not on PATH. */
const CANDIDATE_PATHS: Record<string, string[]> = {
  darwin: ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'],
  linux: ['/usr/bin/git', '/usr/local/bin/git'],
  win32: [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe'
  ]
};

const GIT_ON_PATH = 'git';
const FLAG_VERSION = '--version';

let cached: GitEnvironment | null = null;

/**
 * Resolve git binary once and remember. Override from settings: used as-is
 * for clear errors.
 */
export async function resolveGit(override?: string | null): Promise<GitEnvironment>
{
  if (override)
  {
    setGitPath(override);
    const env = await probe(override);
    cached = env;
    return env;
  }

  // git on PATH is common case.
  const onPath = await probe(GIT_ON_PATH);
  if (!onPath.error)
  {
    setGitPath(GIT_ON_PATH);
    cached = onPath;
    return onPath;
  }

  for (const candidate of CANDIDATE_PATHS[platform()] ?? [])
  {
    try
    {
      await access(candidate, constants.X_OK);
    }
    catch
    {
      continue;
    }
    const env = await probe(candidate);
    if (!env.error)
    {
      setGitPath(candidate);
      cached = env;
      return env;
    }
  }

  cached = onPath;
  return onPath;
}

export function getCachedGitEnvironment(): GitEnvironment | null
{
  return cached;
}

/**
 * Ask candidate binary for version. Probe means pointing runner at candidate,
 * then restore: avoids pointing at failed candidate on error.
 */
async function probe(path: string): Promise<GitEnvironment>
{
  const previous = getGitPath();
  setGitPath(path);
  try
  {
    // cwd irrelevant to --version, but spawn needs valid one.
    const out = await runGit(process.cwd(), [FLAG_VERSION], { kind: GIT_KIND_READ });
    return { path, version: parseGitVersion(out) };
  }
  catch (err)
  {
    setGitPath(previous);
    let error: string;
    if (err instanceof Error)
    {
      error = err.message;
    }
    else
    {
      error = String(err);
    }
    return { path, version: null, error };
  }
}
