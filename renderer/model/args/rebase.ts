/**
 * `git rebase` argv. Not a flat list of flags: three are mutually exclusive by
 * construction (date mode vs. interactive/rebase-merges). `--preserve-merges` is
 * dropped: git removed it in 2.34.
 */

// Rebase date modes
const DATE_DEFAULT = 'default';
const DATE_IGNORE = 'ignore';
const DATE_COMMITTER_IS_AUTHOR = 'committer-is-author';

// Rebase steps
const STEP_CONTINUE = 'continue';
const STEP_SKIP = 'skip';
const STEP_EDIT_TODO = 'edit-todo';
const STEP_ABORT = 'abort';

// Git command
const CMD_REBASE = 'rebase';

// Git flags
const FLAG_IGNORE_DATE = '--ignore-date';
const FLAG_COMMITTER_DATE_IS_AUTHOR_DATE = '--committer-date-is-author-date';
const FLAG_INTERACTIVE = '-i';
const FLAG_AUTOSQUASH = '--autosquash';
const FLAG_NO_AUTOSQUASH = '--no-autosquash';
const FLAG_REBASE_MERGES = '--rebase-merges';
const FLAG_UPDATE_REFS = '--update-refs';
const FLAG_NO_UPDATE_REFS = '--no-update-refs';
const FLAG_AUTOSTASH = '--autostash';
const FLAG_ONTO = '--onto';

/**
 * How the rebase treats the dates on the commits it rewrites. A one-of rather than two
 * booleans: both suppress interactive mode, so two checkboxes would let a user tick
 * interactive and a date option together and get a non-interactive rebase with no explanation.
 */
export type RebaseDates = 'default' | 'ignore' | 'committer-is-author';

export interface RebaseDatesInfo {
  value: RebaseDates;
  label: string;
  detail: string;
}

export const REBASE_DATES: readonly RebaseDatesInfo[] = [
  {
    value: DATE_DEFAULT,
    label: 'Keep the author dates, restamp the committer dates',
    detail: "git's default, author date kept, committer date now."
  },
  {
    value: DATE_IGNORE,
    label: 'Restamp both dates to now',
    detail:
      '`--ignore-date`: everything looks written now.'
  },
  {
    value: DATE_COMMITTER_IS_AUTHOR,
    label: 'Keep both dates as they were',
    detail:
      '`--committer-date-is-author-date`: original timestamps kept.'
  }
];

export interface RebaseOptions {
  /** What the branch is replayed onto. */
  upstream: string;
  /** The branch being rebased. Omitted for the current one (what git assumes), keeping the previewed command the one a person would type. */
  branch?: string | null;
  /**
   * The start of the range, exclusive: the `<from>` of `rebase --onto X from branch`.
   * Paired with `onto`, never given alone: `--onto` without a range replays the same
   * commits elsewhere, and a range without `--onto` silently drops commits.
   */
  from?: string | null;
  /** Where the range lands, when a range is being used. */
  onto?: string | null;
  interactive?: boolean;
  /** Only meaningful under `-i`, which always carries one of the pair. */
  autosquash?: boolean;
  /** Replay merge commits as merges rather than flattening them (`--rebase-merges`). */
  rebaseMerges?: boolean;
  dates?: RebaseDates;
  /**
   * Move branches that point into the rebased range. Three-valued: `null` means "say
   * nothing, let `rebase.updaterefs` decide". A flag goes out only when the checkbox
   * differs from the effective config, so a no-op setting reads as a decision nobody made.
   */
  updateRefs?: boolean | null;
  /** Stash before, pop after: git's own round trip rather than the dialog's. */
  autostash?: boolean;
}

export function buildRebaseArgs(options: RebaseOptions): string[]
{
  const {
    upstream,
    branch = null,
    from = null,
    onto = null,
    interactive = false,
    autosquash = false,
    rebaseMerges = false,
    dates = DATE_DEFAULT,
    updateRefs = null,
    autostash = false
  } = options;

  const args = [CMD_REBASE];

  switch (dates)
  {
    case DATE_IGNORE:
      args.push(FLAG_IGNORE_DATE);
      break;
    case DATE_COMMITTER_IS_AUTHOR:
      args.push(FLAG_COMMITTER_DATE_IS_AUTHOR_DATE);
      break;
    default:
      if (interactive)
      {
        let autosquashFlag: string;
        if (autosquash)
        {
          autosquashFlag = FLAG_AUTOSQUASH;
        }
        else
        {
          autosquashFlag = FLAG_NO_AUTOSQUASH;
        }
        args.push(FLAG_INTERACTIVE, autosquashFlag);
      }
      if (rebaseMerges)
      {
        args.push(FLAG_REBASE_MERGES);
      }
      break;
  }

  if (updateRefs !== null)
  {
    if (updateRefs)
    {
      args.push(FLAG_UPDATE_REFS);
    }
    else
    {
      args.push(FLAG_NO_UPDATE_REFS);
    }
  }
  if (autostash)
  {
    args.push(FLAG_AUTOSTASH);
  }
  if (onto)
  {
    args.push(FLAG_ONTO, onto);
  }

  // `<from>` replaces the upstream as the range's start when a range is in use; without a range the upstream is both.
  args.push(from ?? upstream);
  if (branch)
  {
    args.push(branch);
  }

  return args;
}

/** What a rebase git is part-way through can be told to do next. */
export type RebaseStep = 'continue' | 'skip' | 'abort' | 'edit-todo';

export interface RebaseStepInfo {
  step: RebaseStep;
  label: string;
  detail: string;
  /** Drawn as destructive: it throws away everything the rebase has done so far. */
  danger?: boolean;
}

export const REBASE_STEPS: readonly RebaseStepInfo[] = [
  {
    step: STEP_CONTINUE,
    label: 'Continue',
    detail: 'Carry on once the result is staged.'
  },
  {
    step: STEP_SKIP,
    label: 'Skip this commit',
    detail: 'Skip this commit. Its changes are lost.'
  },
  {
    step: STEP_EDIT_TODO,
    label: 'Edit the todo list',
    detail: 'Reorder or change what the rest of the rebase will do.'
  },
  {
    step: STEP_ABORT,
    label: 'Abort',
    detail: 'Put the branch back where it was before the rebase started.',
    danger: true
  }
];

export function buildRebaseStepArgs(step: RebaseStep): string[]
{
  return [CMD_REBASE, `--${step}`];
}
