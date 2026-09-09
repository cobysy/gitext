/**
 * Remotes from git config (not remote -v). Only form that sees deactivated remotes (-remote.<name>).
 */

import type { RemoteEntry } from '@shared/types.js';
import { parseRemotes } from './parse.js';
import { GIT_KIND_WRITE, tryGit } from './runner.js';

const CMD_CONFIG = 'config';
const CMD_REMOTE = 'remote';
const FLAG_NUL_TERMINATED = '--null';
const FLAG_GET_REGEXP = '--get-regexp';
const FLAG_LOCAL = '--local';
const FLAG_REMOVE_SECTION = '--remove-section';
const FLAG_RENAME_SECTION = '--rename-section';
const PATH_SEPARATOR = '--';

export async function listRemotes(repoPath: string): Promise<RemoteEntry[]>
{
  // Exits 1 with no output when nothing matches, which is a repository with no
  // remotes rather than a failure.
  const out = await tryGit(repoPath, [
    CMD_CONFIG,
    FLAG_NUL_TERMINATED,
    FLAG_GET_REGEXP,
    // Both spellings in one read: `remote.origin.url` and the deactivated
    // `-remote.origin.url`. `--get-regexp` matches anywhere in the key unless anchored,
    // and the anchor has to allow the leading dash.
    '^-?remote\\..*\\.(url|pushurl)$'
  ]);
  if (out)
  {
    return parseRemotes(out);
  }
  else
  {
    return [];
  }
}

/** Remote names, needed to tell `origin/main` from a local branch containing a slash. */
export async function getRemoteNames(repoPath: string): Promise<string[]>
{
  const out = await tryGit(repoPath, [CMD_REMOTE]);
  if (out)
  {
    return out
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
  }
  else
  {
    return [];
  }
}

/**
 * Turn a remote off, or back on.
 *
 * Not a git operation on the repository: the config section is *renamed*, from
 * `remote.<name>` to `-remote.<name>` or back, and git simply stops recognising it. So no
 * fetch, no push, and nothing about the remote's URLs or refspecs changes, which is what
 * makes it reversible, and the reason it is not a dialog.
 *
 * `--rename-section` rather than reading every key and writing it back under the other
 * name: it is one command, and it keeps the multi-valued keys a remote really has (a
 * `fetch` refspec line per pattern) as several values rather than collapsing them.
 *
 * The `--` matters. The destination is `-remote.<name>`, and without it git's option
 * parser reads the leading dash and fails with "unknown switch `r'".
 */
export async function setRemoteEnabled(
  repoPath: string,
  name: string,
  enabled: boolean
): Promise<void>
{
  let from;
  if (enabled)
  {
    from = `-remote.${name}`;
  }
  else
  {
    from = `remote.${name}`;
  }
  let to;
  if (enabled)
  {
    to = `remote.${name}`;
  }
  else
  {
    to = `-remote.${name}`;
  }

  // The destination may already exist: a remote deactivated here, then re-added from the
  // command line under the same name. Renaming onto it *merges* the two rather than
  // replacing, leaving a section with two `url` values, so it is cleared first. `tryGit`:
  // not existing is the normal case, not a failure.
  await tryGit(repoPath, [CMD_CONFIG, FLAG_LOCAL, FLAG_REMOVE_SECTION, PATH_SEPARATOR, to], {
    kind: GIT_KIND_WRITE
  });

  // `tryGit` here too: a remote that is not there is nothing to switch, and the panel row
  // that asked has already gone stale if that happened.
  await tryGit(
    repoPath,
    [CMD_CONFIG, FLAG_LOCAL, FLAG_RENAME_SECTION, PATH_SEPARATOR, from, to],
    { kind: GIT_KIND_WRITE }
  );
}
