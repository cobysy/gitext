/**
 * App preferences only. Git config (user.name, core.autocrlf, merge.tool) is read
 * and written through `git config` for a single source of truth.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, toGraphDimming, type Settings } from '@shared/types.js';

const CONFIG_FILE_NAME = 'config.json';
const ENCODING_UTF8 = 'utf8';

let filePath = '';
let current: Settings = { ...DEFAULT_SETTINGS };

function configPath(): string
{
  if (!filePath)
  {
    filePath = join(app.getPath('userData'), CONFIG_FILE_NAME);
  }
  return filePath;
}

export function loadSettings(): Settings
{
  try
  {
    const raw = readFileSync(configPath(), ENCODING_UTF8);
    // Reconcile shape changes (one field changed format). Doing this once at load
    // lets every window rely on a single current shape.
    const parsed = JSON.parse(raw) as Partial<Settings> & { graphDimNonRelativesText?: unknown };
    // Merge over defaults so a config written by an older build stays valid.
    current = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      graphDimNonRelatives: toGraphDimming(
        parsed.graphDimNonRelatives,
        parsed.graphDimNonRelativesText
      )
    };
  }
  catch
  {
    // A corrupt or unreadable config used to be replaced silently, taking every preference
    // with it and leaving no way to see what had been there. Keep the bad file beside the
    // good one: recovering a hand-edited setting from `config.json.bad` is possible,
    // recovering it from nothing is not.
    keepCorruptConfig();
    current = { ...DEFAULT_SETTINGS };
  }
  return current;
}

/** Move an unparseable config aside rather than overwriting it. */
function keepCorruptConfig(): void
{
  const target = configPath();
  try
  {
    if (existsSync(target))
    {
      renameSync(target, `${target}.bad`);
    }
  }
  catch
  {
    // Nothing further to try: the settings still load from defaults, which is the point.
  }
}

export function getSettings(): Settings
{
  return current;
}

export function patchSettings(patch: Partial<Settings>): Settings
{
  current = { ...current, ...patch };
  save();
  return current;
}

/**
 * Canonical form of a repository path, for comparing two of them.
 *
 * macOS makes `/var` a symlink to `/private/var`, so a repository reached both ways is
 * two strings for one directory and the recent list grows a duplicate per visit. git
 * canonicalizes; so does this. A path that no longer resolves is returned unchanged, so
 * a missing repository still compares equal to itself.
 */
function canonical(repoPath: string): string
{
  try
  {
    return realpathSync(repoPath);
  }
  catch
  {
    return repoPath;
  }
}

/** Move `repoPath` to the front of the recent list, capped at 10. */
export function recordRecentRepo(repoPath: string): Settings
{
  const resolved = canonical(repoPath);
  const others = current.recentRepos.filter((p) => canonical(p) !== resolved);
  const recentRepos = [resolved, ...others].slice(0, 10);
  return patchSettings({ recentRepos });
}

/** Drop one entry from the recent list. */
export function forgetRecentRepo(repoPath: string): Settings
{
  const resolved = canonical(repoPath);
  return patchSettings({
    recentRepos: current.recentRepos.filter((p) => canonical(p) !== resolved)
  });
}

/**
 * The recent list with the directories that are gone taken out, deduplicated.
 *
 * Read at startup rather than filtered on every render: a repository on an unmounted
 * volume should not cost a `stat` per paint, and a list that silently drops an entry the
 * moment a disk is unplugged is worse than one that is a moment stale.
 */
export function pruneRecentRepos(): Settings
{
  const seen = new Set<string>();
  const recentRepos: string[] = [];
  for (const path of current.recentRepos)
  {
    if (!existsSync(path))
    {
      continue;
    }
    const resolved = canonical(path);
    if (seen.has(resolved))
    {
      continue;
    }
    seen.add(resolved);
    recentRepos.push(resolved);
  }
  if (recentRepos.length === current.recentRepos.length
    && recentRepos.every((p, i) => p === current.recentRepos[i]))
  {
    return current;
  }
  return patchSettings({ recentRepos });
}

function save(): void
{
  const target = configPath();
  try
  {
    mkdirSync(dirname(target), { recursive: true });
    // Write to temp file, then rename, to avoid truncating on crash.
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(current, null, 2), ENCODING_UTF8);
    renameSync(tmp, target);
  }
  catch (err)
  {
    console.error('Failed to save settings:', err);
  }
}
