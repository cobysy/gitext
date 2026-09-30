/**
 * The commit screen's argv: `git commit` itself, and the steps that go before it when the
 * commit takes everything or starts a branch of its own.
 *
 * Built here, not in the store, so the preview and the run read one array.
 */

import { HISTORY_MOVE, STAGING, type RepoFacet } from '@shared/invalidation.js';

const CMD_COMMIT = 'commit';
const CMD_ADD = 'add';
const CMD_SWITCH = 'switch';
const FLAG_ALL = '-A';
const FLAG_CREATE = '-c';
const FLAG_AMEND = '--amend';
const FLAG_RESET_AUTHOR = '--reset-author';
const FLAG_AUTHOR = '--author';
const FLAG_NO_VERIFY = '--no-verify';
const FLAG_CLEANUP_STRIP = '--cleanup=strip';
const FLAG_MESSAGE = '-m';
const FLAG_NO_EDIT = '--no-edit';

/** A new branch moves HEAD onto a ref that did not exist; neither tree changes. */
const NEW_BRANCH: readonly RepoFacet[] = ['head', 'refs'];

export interface CommitOptions {
  message: string;
  amend: boolean;
  resetAuthor: boolean;
  /** `Name <email>`, or `''` for git's own answer. */
  author: string;
  noVerify: boolean;
  /** Finishing a merge, cherry-pick or revert, whose prepared message carries `#` lines. */
  finishingOperation: boolean;
}

/** How much of the working tree goes in, and onto which branch. */
export interface CommitScope {
  /** Stage everything first, untracked files included. */
  all: boolean;
  /** Create this branch and switch to it first, or `''` to commit where HEAD is. */
  newBranch: string;
}

export interface CommitStep {
  label: string;
  argv: string[];
  invalidates: readonly RepoFacet[];
}

export function buildCommitArgv(options: CommitOptions): string[]
{
  const args = [CMD_COMMIT];
  if (options.amend)
  {
    args.push(FLAG_AMEND);
  }
  if (options.resetAuthor)
  {
    args.push(FLAG_RESET_AUTHOR);
  }
  // After `--reset-author`: the two disagree and the later flag wins, so naming an author, the more specific instruction, has to settle which wins explicitly.
  const author = options.author.trim();
  if (author)
  {
    args.push(FLAG_AUTHOR, author);
  }
  if (options.noVerify)
  {
    args.push(FLAG_NO_VERIFY);
  }
  // `-m`'s default cleanup is `whitespace`, not `strip`: it leaves `#`-prefixed lines
  // alone, and the box prefilled from `MERGE_MSG` is full of them (`# Conflicts:`), so
  // left in they'd land in the commit verbatim. `--no-edit` never needs this: reading
  // the file through git's own commit machinery already strips them.
  if (options.finishingOperation)
  {
    args.push(FLAG_CLEANUP_STRIP);
  }
  const message = options.message.trim();
  if (message)
  {
    args.push(FLAG_MESSAGE, message);
  }
  else
  {
    args.push(FLAG_NO_EDIT);
  }
  return args;
}

/**
 * The commands a commit runs, in order: the branch first, so a name git refuses stops
 * everything before the index is touched; then the staging; then the commit.
 * `add -A` rather than `commit -a`, which leaves untracked files out.
 */
export function buildCommitSteps(options: CommitOptions, scope: CommitScope): CommitStep[]
{
  const steps: CommitStep[] = [];
  const branch = scope.newBranch.trim();
  if (branch)
  {
    steps.push({ label: 'Creating the branch', argv: [CMD_SWITCH, FLAG_CREATE, branch], invalidates: NEW_BRANCH });
  }
  if (scope.all)
  {
    steps.push({ label: 'Staging everything', argv: [CMD_ADD, FLAG_ALL], invalidates: STAGING });
  }
  steps.push({ label: 'Committing', argv: buildCommitArgv(options), invalidates: HISTORY_MOVE });
  return steps;
}
