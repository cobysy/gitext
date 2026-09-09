/**
 * `git fetch` and `git pull` argv. Both share one argument builder (remote, refspec,
 * tags, prune, unshallow), differing only in the verb and `--rebase`: two builders would
 * be two chances for fetch and pull to disagree about what "fetch this branch" means.
 *
 * ```
 * fetch  --progress <tail>
 * pull   [--rebase] --progress <tail>
 * tail:  <remote> [+<remoteBranch>[:refs/heads/<local>]]
 *        [--tags|--no-tags] [--unshallow] [--prune --force] [--prune-tags]
 * ```
 */

// Pull actions
const PULL_ACTION_MERGE = 'merge';
const PULL_ACTION_REBASE = 'rebase';
export const PULL_ACTION_FETCH = 'fetch';

// Tag fetch modes
const TAG_FETCH_DEFAULT = 'default';
const TAG_FETCH_NONE = 'none';
const TAG_FETCH_ALL = 'all';

// Git command and flags
const CMD_FETCH = 'fetch';
const CMD_PULL = 'pull';
const FLAG_PROGRESS = '--progress';
const FLAG_REBASE = '--rebase';
const FLAG_TAGS = '--tags';
const FLAG_NO_TAGS = '--no-tags';
const FLAG_UNSHALLOW = '--unshallow';
const FLAG_PRUNE = '--prune';
const FLAG_FORCE = '--force';
const FLAG_PRUNE_TAGS = '--prune-tags';

/** What `pull` does with what it fetched, or whether it pulls at all. */
export type PullAction = 'merge' | 'rebase' | 'fetch';

export interface PullActionInfo {
  action: PullAction;
  label: string;
  detail: string;
}

export const PULL_ACTIONS: readonly PullActionInfo[] = [
  {
    action: PULL_ACTION_MERGE,
    label: 'Merge into the current branch',
    detail: "git's default: a merge commit when the branches have diverged."
  },
  {
    action: PULL_ACTION_REBASE,
    label: 'Rebase the current branch on top',
    detail:
      '`--rebase`: replays your commits on top. They are rewritten.'
  },
  {
    action: PULL_ACTION_FETCH,
    label: 'Fetch only, do not touch the current branch',
    detail:
      'Updates remote-tracking refs and nothing else.'
  }
];

/**
 * Whether to bring tags along. Three-valued: git's default is neither flag, following
 * `remote.<name>.tagOpt` and otherwise taking tags on objects it downloads anyway;
 * writing `--no-tags` to mean "the default" would change the behaviour.
 */
export type TagFetchMode = 'default' | 'none' | 'all';

export interface FetchOptions {
  /** The remote's name, or a URL. Empty fetches the default for the current branch. */
  remote?: string;
  /** One branch to fetch, rather than the remote's whole refspec. */
  remoteBranch?: string;
  /** The local branch the fetched one is written to: `+<remote>:refs/heads/<local>`. Fetch only: git refuses to fetch into the checked-out branch. */
  localBranch?: string;
  tags?: TagFetchMode;
  /** Deepen a shallow clone all the way: only meaningful when `.git/shallow` exists. */
  unshallow?: boolean;
  /** Delete remote-tracking refs for branches that are gone from the remote. */
  prune?: boolean;
  /** Prune tags as well as branches. Implies `prune`. */
  pruneTags?: boolean;
}

/**
 * The shared tail: everything after the verb and `--progress`. The `+` in front of the
 * refspec is an unconditional force marker: without it, a fetch into a named local
 * branch that isn't a fast-forward would fail, exactly the case this form is for.
 */
export function buildFetchArgs(options: FetchOptions = {}): string[]
{
  const {
    remote = '',
    remoteBranch = '',
    localBranch = '',
    tags = TAG_FETCH_DEFAULT,
    unshallow = false,
    prune = false,
    pruneTags = false
  } = options;

  // A branch name cannot contain a space and a typed field can.
  const from = remoteBranch.replace(/\s+/g, '').replace(/^\+/, '');
  const into = localBranch.replace(/\s+/g, '');

  let refspec;
  if (from)
  {
    let intoPart: string;
    if (into)
    {
      intoPart = `:refs/heads/${into}`;
    }
    else
    {
      intoPart = '';
    }
    refspec = `+${from}${intoPart}`;
  }
  else
  {
    refspec = '';
  }

  const args = [];
  if (remote.trim())
  {
    args.push(remote.trim());
  }
  if (refspec)
  {
    args.push(refspec);
  }
  if (tags === TAG_FETCH_ALL)
  {
    args.push(FLAG_TAGS);
  }
  if (tags === TAG_FETCH_NONE)
  {
    args.push(FLAG_NO_TAGS);
  }
  if (unshallow)
  {
    args.push(FLAG_UNSHALLOW);
  }
  // `--force` lets a prune proceed when a tracking ref has been replaced by one whose name it is now a prefix of.
  if (prune || pruneTags)
  {
    args.push(FLAG_PRUNE, FLAG_FORCE);
  }
  if (pruneTags)
  {
    args.push(FLAG_PRUNE_TAGS);
  }
  return args;
}

export interface PullOptions extends FetchOptions {
  action: PullAction;
}

/** One command for both, since the dialog is one dialog. `--progress` unconditionally: git suppresses it off a terminal, and this app reads that output into the command log. */
export function buildPullArgs(options: PullOptions): string[]
{
  const { action, ...fetch } = options;

  if (action === PULL_ACTION_FETCH)
  {
    return [CMD_FETCH, FLAG_PROGRESS, ...buildFetchArgs(fetch)];
  }

  const args = [CMD_PULL];
  if (action === PULL_ACTION_REBASE)
  {
    args.push(FLAG_REBASE);
  }
  args.push(FLAG_PROGRESS);
  // `pull` never writes into a named local branch: git refuses to fetch into the checked-out one, the only branch a pull could mean.
  args.push(...buildFetchArgs({ ...fetch, localBranch: '' }));
  return args;
}

// `buildRemotePruneArgs` is in `args/remote.ts`, with the rest of `git remote`, rather than
// here beside the fetch that suggests it. The pull dialog imports it.
