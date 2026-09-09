/**
 * `git checkout` argv.
 *
 * Flag order: `--merge`/`--force` for local changes, then `-b`/`-B` and `--track` for a
 * new branch, then the ref.
 */

// Local changes modes
export const LOCAL_CHANGES_NONE = 'none' as const;
export const LOCAL_CHANGES_MERGE = 'merge' as const;
export const LOCAL_CHANGES_RESET = 'reset' as const;
// The two more the *choice* offers beyond argv itself: `stash` runs `git stash`/pop
// around the checkout; `branch` routes into `LOCAL_CHANGE_BRANCHES` below instead.
export const LOCAL_CHANGES_STASH = 'stash' as const;
export const LOCAL_CHANGES_BRANCH = 'branch' as const;

// New branch modes
const NEW_BRANCH_NONE = 'none';
const NEW_BRANCH_CREATE = 'create';
const NEW_BRANCH_RESET = 'reset';

// Local changes branch modes
const BRANCH_MODE_COMMIT = 'commit';
const BRANCH_MODE_CARRY = 'carry';
const BRANCH_MODE_STASH = 'stash';

// Branch ends on values
export const ENDS_ON_TARGET = 'target';
const ENDS_ON_NEW_BRANCH = 'newBranch';

// Git commands
const CMD_CHECKOUT = 'checkout';
const CMD_STASH = 'stash';
const CMD_ADD = 'add';
const CMD_COMMIT = 'commit';
const CMD_FETCH = 'fetch';

// Git flags
const FLAG_NEW_BRANCH = '-b';
const FLAG_FORCE_NEW_BRANCH = '-B';
const FLAG_TRACK = '--track';
const FLAG_MERGE = '--merge';
const FLAG_FORCE = '--force';
const FLAG_PROGRESS = '--progress';
const FLAG_MESSAGE = '-m';
const FLAG_ADD_ALL = '-A';
const FLAG_INCLUDE_UNTRACKED = '-u';

// git stash subcommands
const STASH_PUSH = 'push';
const STASH_POP = 'pop';
const STASH_BRANCH = 'branch';

/**
 * What to do with uncommitted changes that are in the way. `'stash'` is deliberately
 * not here: it's not a flag, it's a `git stash` before and an offer to pop after, three commands belonging to the dialog's `runSteps`.
 */
export type LocalChanges =
  | typeof LOCAL_CHANGES_NONE
  | typeof LOCAL_CHANGES_MERGE
  | typeof LOCAL_CHANGES_RESET;

/** The five `LocalChangesChoice` offers: `LocalChanges` plus the two that are commands. */
export type LocalChangesChoiceValue = LocalChanges | typeof LOCAL_CHANGES_STASH | typeof LOCAL_CHANGES_BRANCH;

/** What to do about a local branch when checking out a remote one. */
export type NewBranchMode = 'none' | 'create' | 'reset';

export interface CheckoutOptions {
  /** The branch, tag or SHA being checked out. */
  ref: string;
  /** Whether `ref` names a remote branch: the new-branch modes below apply only then, `-b` on a local branch would be a different dialog. */
  remote?: boolean;
  localChanges?: LocalChanges;
  newBranchMode?: NewBranchMode;
  /** The local branch name to create or reset. Required by both non-`'none'` modes. */
  newBranchName?: string;
}

export function buildCheckoutArgs(options: CheckoutOptions): string[]
{
  const {
    ref,
    remote = false,
    localChanges = LOCAL_CHANGES_NONE,
    newBranchMode = NEW_BRANCH_NONE,
    newBranchName
  } = options;

  const args = [CMD_CHECKOUT];

  if (localChanges === LOCAL_CHANGES_MERGE)
  {
    args.push(FLAG_MERGE);
  }
  if (localChanges === LOCAL_CHANGES_RESET)
  {
    args.push(FLAG_FORCE);
  }

  // A mode with no name is a form not filled in yet; the dialog disables its button
  // rather than building an argv with a hole in it.
  if (remote && newBranchName)
  {
    if (newBranchMode === NEW_BRANCH_CREATE)
    {
      args.push(FLAG_NEW_BRANCH, newBranchName, FLAG_TRACK);
    }
    if (newBranchMode === NEW_BRANCH_RESET)
    {
      args.push(FLAG_FORCE_NEW_BRANCH, newBranchName);
    }
  }

  args.push(ref);
  return args;
}

/** One command of a plan, and the sentence its failure belongs to. See `useDialog`. */
export interface ArgvStep {
  label: string;
  argv: string[];
}

/**
 * `git stash push` as a checkout runs it to get out of the way. `push`, not bare
 * `git stash`: `save` is deprecated and the bare form's meaning has changed before. `-u` sweeps untracked files in too.
 */
export function buildAutoStashArgs(includeUntracked = false): string[]
{
  const args = [CMD_STASH, STASH_PUSH];
  if (includeUntracked)
  {
    args.push(FLAG_INCLUDE_UNTRACKED);
  }
  return args;
}

/** The other half of the round trip, run only if the user says yes afterwards. */
export function buildStashPopArgs(): string[]
{
  return [CMD_STASH, STASH_POP];
}

// ── Putting the changes on a branch ──────────────────────────────────────────

/**
 * The three ways uncommitted work can become a branch instead of a problem: the usual
 * four (don't change, merge, stash, reset) either refuse or destroy, missing "worth
 * keeping, just not on this branch". Only `commit` leaves you on the branch you asked
 * for; `carry` and `stash` both leave you on the new branch, as git's own commands do.
 */
export type LocalChangesBranchMode = 'commit' | 'carry' | 'stash';

export interface LocalChangesBranch {
  mode: LocalChangesBranchMode;
  /** The branch to create. Required: every one of the three names something. */
  name: string;
  /** The branch the work is sitting on now, for the WIP commit's message. */
  from?: string | null;
}

/** What a strategy needs to write its steps. */
interface BranchStrategyContext {
  /** The new branch's name. */
  name: string;
  /** The ref the dialog was asked to check out. */
  ref: string;
  from?: string | null;
  stashUntracked: boolean;
}

export interface LocalChangesBranchInfo {
  mode: LocalChangesBranchMode;
  label: string;
  /** What it does, in one line. Rendered as the radio's hint. */
  detail: string;
  /**
   * Which branch you're on when it finishes: the difference that actually matters
   * between these three. The dialog renders it as its own line, naming the branch rather than describing it.
   */
  endsOn: 'target' | 'newBranch';
  steps: (context: BranchStrategyContext) => ArgvStep[];
}

/**
 * `git stash`'s own wording for a WIP commit, so the log reads the way a stash entry does.
 */
function wipMessage(from?: string | null): string
{
  if (from)
  {
    return `WIP on ${from}`;
  }
  else
  {
    return 'WIP';
  }
}

/**
 * The three, as a table: what the radio renders *and* what the argv is built from, the
 * same arrangement `RESET_MODES` uses: a fourth strategy is a row here, not another branch inside `buildCheckoutSteps`.
 */
export const LOCAL_CHANGE_BRANCHES: readonly LocalChangesBranchInfo[] = [
  {
    mode: BRANCH_MODE_COMMIT,
    label: 'Commit them to a new branch first',
    detail: 'Commits here first, then checks out.',
    endsOn: ENDS_ON_TARGET,
    steps: ({ name, ref, from }) => [
      { label: `Creating '${name}'`, argv: [CMD_CHECKOUT, FLAG_NEW_BRANCH, name] },
      // `-A`, not `-u`: parking work leaves nothing behind, so an unstaged new file would carry into the branch being checked out next.
      { label: 'Staging your changes', argv: [CMD_ADD, FLAG_ADD_ALL] },
      { label: 'Committing your changes', argv: [CMD_COMMIT, FLAG_MESSAGE, wipMessage(from)] },
      { label: 'Checking out', argv: buildCheckoutArgs({ ref }) }
    ]
  },
  {
    mode: BRANCH_MODE_CARRY,
    label: 'Take them with me to a new branch',
    detail: 'Takes the changes onto a new branch.',
    endsOn: ENDS_ON_NEW_BRANCH,
    steps: ({ name, ref }) => [
      { label: `Creating '${name}' from ${ref}`, argv: [CMD_CHECKOUT, FLAG_NEW_BRANCH, name, ref] }
    ]
  },
  {
    mode: BRANCH_MODE_STASH,
    label: 'Stash them, then bring them back on a new branch',
    detail: 'Stashes, then re-applies it on a new branch.',
    endsOn: ENDS_ON_NEW_BRANCH,
    steps: ({ name, stashUntracked }) => [
      { label: 'Stashing your changes', argv: buildAutoStashArgs(stashUntracked) },
      // No checkout between these two: `stash branch` creates from the stash's commit
      // and switches to it, so a checkout here would be undone immediately.
      { label: `Bringing them back on '${name}'`, argv: [CMD_STASH, STASH_BRANCH, name] }
    ]
  }
];

export interface CheckoutPlanOptions extends CheckoutOptions {
  /**
   * Stash before checking out. The dialog decides this: `localChanges === 'stash'`
   * *and* a dirty tree, since a clean tree would stash nothing to offer back.
   */
  stash?: boolean;
  stashUntracked?: boolean;
  /** Put the changes on a branch instead, replacing the plan entirely: the strategies above each end in their own checkout, or deliberately in none. */
  branch?: LocalChangesBranch;
}

/** A remote branch, split: `origin` and `feature/x`. What a fetch refspec is built from. */
export interface RemoteBranchRef {
  remote: string;
  branch: string;
}

/**
 * `git fetch <remote> <branch>`: one branch, for the panel's Fetch row. No
 * `+<branch>:refs/heads/<local>` refspec, unlike the pull dialog's: this only brings
 * `refs/remotes/<remote>/<branch>` up to date via the remote's configured refspec.
 */
export function buildFetchBranchArgs(ref: RemoteBranchRef): string[]
{
  return [CMD_FETCH, FLAG_PROGRESS, ref.remote, ref.branch];
}

/**
 * Everything a checkout runs, in order, before the offer to pop. A plan, not one argv:
 * "stash" is a command in front of the checkout, so its failure must not report as the
 * checkout failing. The pop is deliberately not here: it runs only if the user says yes after the checkout has already succeeded.
 */
export function buildCheckoutSteps(options: CheckoutPlanOptions): ArgvStep[]
{
  const { stash = false, stashUntracked = false, branch, ...checkout } = options;

  // A branch strategy is the whole plan, not a step in front of one: two of the three
  // never run `checkout <ref>` at all. An unnamed branch is a form still being filled in.
  if (branch?.name)
  {
    const strategy = LOCAL_CHANGE_BRANCHES.find((entry) => entry.mode === branch.mode);
    if (strategy)
    {
      return strategy.steps({
        name: branch.name,
        ref: checkout.ref,
        from: branch.from,
        stashUntracked
      });
    }
  }

  const args = [];
  if (stash)
  {
    args.push({ label: 'Stashing your changes', argv: buildAutoStashArgs(stashUntracked) });
  }
  args.push({ label: 'Checking out', argv: buildCheckoutArgs(checkout) });
  return args;
}

/**
 * Whether a checkout makes a branch that did not exist, and so whether the ref list has to
 * be reloaded after it.
 *
 * A local checkout creates nothing: `git checkout main` moves HEAD and rewrites the
 * working tree, which is why `CHECKOUT` is `head` and `worktree` and says so. Checking out
 * a *remote* branch is `git checkout -B feature origin/feature`, and a branch the panel has
 * never heard of does not appear until something reloads the refs. Nothing announced it,
 * so the panel filled in a second late when the `.git` watcher fired with `ALL_FACETS`, or
 * not at all.
 *
 * Here rather than in the dialog because it is a property of the argv above it: `-b` and
 * `-B` are the two flags that create, and `none` is the detached checkout that does not.
 */
export function checkoutCreatesBranch(isRemote: boolean, mode: NewBranchMode): boolean
{
  return isRemote && mode !== 'none';
}
