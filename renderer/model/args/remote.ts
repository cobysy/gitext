/**
 * `git remote` argv. Two spellings chosen for the command log: `remove`, not `rm`
 * (documented and readable to someone who hasn't memorised the abbreviations), and the
 * push URL as `remote set-url --push`, not a raw `config` write, so the log shows a command about remotes rather than config keys.
 */

const CMD_REMOTE = 'remote';
const CMD_CONFIG = 'config';
const SUBCOMMAND_ADD = 'add';
const SUBCOMMAND_RENAME = 'rename';
const SUBCOMMAND_REMOVE = 'remove';
const SUBCOMMAND_SET_URL = 'set-url';
const SUBCOMMAND_PRUNE = 'prune';
const FLAG_PUSH = '--push';
const FLAG_UNSET = '--unset';

/** What a remote is, as the dialog edits it. */
export interface RemoteDraft {
  name: string;
  fetchUrl: string;
  /** Where pushes go, when somewhere else: `remote.<name>.pushurl`. Empty means "the same place as fetches", git's own behaviour rather than a stored value. */
  pushUrl: string;
}

/**
 * A remote as read, as the dialog's editable draft. `RemoteEntry.pushUrl` falls back to
 * the fetch URL, since that's what git *does* with no `pushurl` set, but not what it has
 * *stored*; showing that fallback in the push box would write a `pushurl` never asked for. Equal means unset here.
 */
export function draftFromRemote(entry: {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}): RemoteDraft
{
  let pushUrl: string;
  if (entry.pushUrl === entry.fetchUrl)
  {
    pushUrl = '';
  }
  else
  {
    pushUrl = entry.pushUrl;
  }
  return { name: entry.name, fetchUrl: entry.fetchUrl, pushUrl };
}

export function buildRemoteAddArgs(name: string, url: string): string[]
{
  const remote = name.trim();
  const target = url.trim();
  if (remote && target)
  {
    return [CMD_REMOTE, SUBCOMMAND_ADD, remote, target];
  }
  else
  {
    return [];
  }
}

/** True when `before` and `after` are both non-empty and actually name a rename. */
function isValidRename(before: string, after: string): boolean
{
  return !!before && !!after && before !== after;
}

export function buildRemoteRenameArgs(from: string, to: string): string[]
{
  const before = from.trim();
  const after = to.trim();
  if (isValidRename(before, after))
  {
    return [CMD_REMOTE, SUBCOMMAND_RENAME, before, after];
  }
  else
  {
    return [];
  }
}

export function buildRemoteRemoveArgs(name: string): string[]
{
  if (name.trim())
  {
    return [CMD_REMOTE, SUBCOMMAND_REMOVE, name.trim()];
  }
  else
  {
    return [];
  }
}

/** `git remote set-url [--push] <name> <url>`. */
export function buildRemoteSetUrlArgs(
  name: string,
  url: string,
  options: { push?: boolean } = {}
): string[]
{
  const remote = name.trim();
  const target = url.trim();
  if (!remote || !target)
  {
    return [];
  }
  const args = [CMD_REMOTE, SUBCOMMAND_SET_URL];
  if (options.push)
  {
    args.push(FLAG_PUSH);
  }
  args.push(remote);
  args.push(target);
  return args;
}

/**
 * Clearing a push URL, so the remote goes back to pushing where it fetches. `config
 * --unset`, not `remote set-url --delete`: that takes the removed URL as a *pattern* and would need the old value, but emptying a field shouldn't depend on it.
 */
export function buildRemoteClearPushUrlArgs(name: string): string[]
{
  if (name.trim())
  {
    return [CMD_CONFIG, FLAG_UNSET, `remote.${name.trim()}.pushurl`];
  }
  else
  {
    return [];
  }
}

/** `git remote prune <remote>`: what git suggests when a tracking ref is stale. */
export function buildRemotePruneArgs(remote: string): string[]
{
  if (remote.trim())
  {
    return [CMD_REMOTE, SUBCOMMAND_PRUNE, remote.trim()];
  }
  else
  {
    return [];
  }
}

/** One step of a plan: an argv, and what to call it if it fails. */
export interface RemoteStep {
  label: string;
  argv: string[];
}

/**
 * Everything that turns `original` into `edited`, in the order it has to run. The
 * rename goes **first**, every later step naming the new name: `git remote set-url`
 * takes a remote by name, so a URL written before the rename would either land on the
 * old name or fail. Empty when nothing changed, leaving the button disabled.
 */
export function buildRemoteSaveSteps(
  original: RemoteDraft,
  edited: RemoteDraft
): RemoteStep[]
{
  const name = edited.name.trim();
  const steps: RemoteStep[] = [];

  if (!name)
  {
    return steps;
  }

  if (original.name !== name)
  {
    steps.push({
      label: `Renaming ${original.name} to ${name}`,
      argv: buildRemoteRenameArgs(original.name, name)
    });
  }

  if (original.fetchUrl.trim() !== edited.fetchUrl.trim() && edited.fetchUrl.trim())
  {
    steps.push({
      label: `Setting the URL for ${name}`,
      argv: buildRemoteSetUrlArgs(name, edited.fetchUrl)
    });
  }

  const pushBefore = original.pushUrl.trim();
  const pushAfter = edited.pushUrl.trim();
  if (pushBefore !== pushAfter)
  {
    if (pushAfter)
    {
      steps.push({
        label: `Setting the push URL for ${name}`,
        argv: buildRemoteSetUrlArgs(name, pushAfter, { push: true })
      });
    }
    else
    {
      steps.push({
        label: `Clearing the push URL for ${name}`,
        argv: buildRemoteClearPushUrlArgs(name)
      });
    }
  }

  return steps;
}
