/**
 * `git push` argv.
 *
 * ```
 * one branch: push <force> [-u] [--recurse-submodules=…] --progress <remote> <from>[:<to>]
 * all:        push <force> [-u] [--recurse-submodules=…] --progress --all <remote>
 * tags:       push <force> --progress <remote> (--tags | tag <name>)
 * ```
 */

import { HEAD_REF } from '@renderer/model/sha.js';

// Force modes
const FORCE_MODE_NONE = 'none';
const FORCE_MODE_LEASE = 'lease';
const FORCE_MODE_FORCE = 'force';

// Submodule modes
const SUBMODULE_MODE_NONE = 'none';

// Git command and flags
const CMD_PUSH = 'push';
const FLAG_PROGRESS = '--progress';
const FLAG_SET_UPSTREAM = '-u';
const FLAG_ALL = '--all';
const FLAG_TAGS = '--tags';
const FLAG_FORCE_WITH_LEASE = '--force-with-lease';
const FLAG_FORCE = '--force';
const TAG_KEYWORD = 'tag';

// Rejection remedies
const REMEDY_PULL_REBASE = 'pull-rebase';
const REMEDY_PULL_MERGE = 'pull-merge';
const REMEDY_FORCE_LEASE = 'force-lease';

/**
 * How hard to push. Three values, not two booleans: `--force` and `--force-with-lease`
 * contradict each other, and git takes the last one on the line, so two ticked boxes would produce a command whose meaning depended on argv order.
 */
export type ForceMode = 'none' | 'force' | 'lease';

export interface ForceModeInfo {
  mode: ForceMode;
  flag: string | null;
  label: string;
  detail: string;
}

export const FORCE_MODES: readonly ForceModeInfo[] = [
  {
    mode: FORCE_MODE_NONE,
    flag: null,
    label: "Don't force",
    detail: 'git refuses if it would discard remote commits.'
  },
  {
    mode: FORCE_MODE_LEASE,
    flag: FLAG_FORCE_WITH_LEASE,
    label: 'Force, unless the remote has moved',
    detail:
      'Overwrites, unless the remote moved since your last fetch.'
  },
  {
    mode: FORCE_MODE_FORCE,
    flag: FLAG_FORCE,
    label: 'Force',
    detail:
      'Overwrites whatever is there. Nothing warns you.'
  }
];

/** `--recurse-submodules`. `check` refuses; `on-demand` pushes them for you. */
export type SubmodulePushMode = 'none' | 'check' | 'on-demand';

export interface PushOptions {
  /** The remote's name, or a URL. */
  remote: string;
  /** The local ref being pushed. */
  from: string;
  /** The remote branch to write to, when it differs from `from`. The short name is passed through, not expanded: `git push origin main:feature` is what a person types. */
  to?: string;
  force?: ForceMode;
  /** Set the upstream while pushing: `-u`. */
  setUpstream?: boolean;
  submodules?: SubmodulePushMode;
}

function forceFlags(force: ForceMode): string[]
{
  const flag = FORCE_MODES.find((entry) => entry.mode === force)?.flag;
  if (flag)
  {
    return [flag];
  }
  else
  {
    return [];
  }
}

function submoduleFlags(mode: SubmodulePushMode): string[]
{
  if (mode === SUBMODULE_MODE_NONE)
  {
    return [];
  }
  else
  {
    return [`--recurse-submodules=${mode}`];
  }
}

export function buildPushArgs(options: PushOptions): string[]
{
  const {
    remote,
    from,
    to = '',
    force = FORCE_MODE_NONE,
    setUpstream = false,
    submodules = SUBMODULE_MODE_NONE
  } = options;

  // A destination with no source means HEAD: pushing "nothing to main" is git's syntax for *deleting* `main`, not what an empty field means here.
  let toFallback: string;
  if (to)
  {
    toFallback = HEAD_REF;
  }
  else
  {
    toFallback = '';
  }
  const source = from || toFallback;
  let refspec;
  if (to && to !== source)
  {
    refspec = `${source}:${to}`;
  }
  else
  {
    refspec = source;
  }

  const args = [CMD_PUSH, ...forceFlags(force)];
  if (setUpstream)
  {
    args.push(FLAG_SET_UPSTREAM);
  }
  args.push(...submoduleFlags(submodules));
  args.push(FLAG_PROGRESS);
  if (remote.trim())
  {
    args.push(remote.trim());
  }
  if (refspec)
  {
    args.push(refspec);
  }
  return args;
}

/** Every branch at once: `push --all`. */
export function buildPushAllArgs(
  options: Omit<PushOptions, 'from' | 'to'>
): string[]
{
  const {
    remote,
    force = FORCE_MODE_NONE,
    setUpstream = false,
    submodules = SUBMODULE_MODE_NONE
  } = options;
  const args = [CMD_PUSH, ...forceFlags(force)];
  if (setUpstream)
  {
    args.push(FLAG_SET_UPSTREAM);
  }
  args.push(...submoduleFlags(submodules));
  args.push(FLAG_PROGRESS);
  args.push(FLAG_ALL);
  if (remote.trim())
  {
    args.push(remote.trim());
  }
  return args;
}

export interface PushTagOptions {
  remote: string;
  /** One tag's name. Ignored when `all` is set. */
  tag?: string;
  /** Push every tag: `--tags`. */
  all?: boolean;
  force?: ForceMode;
}

/**
 * `git push <remote> tag <name>`, or `--tags` for all of them. The `tag` keyword, not a
 * bare name: a tag and a branch may share one, and `git push origin v1.0` would push whichever git resolved first.
 */
export function buildPushTagArgs(options: PushTagOptions): string[]
{
  const { remote, tag = '', all = false, force = FORCE_MODE_NONE } = options;
  if (!all && !tag.trim())
  {
    return [];
  }

  const args = [CMD_PUSH, ...forceFlags(force), FLAG_PROGRESS];
  if (remote.trim())
  {
    args.push(remote.trim());
  }
  if (all)
  {
    args.push(FLAG_TAGS);
  }
  else
  {
    args.push(TAG_KEYWORD, tag.replace(/\s+/g, ''));
  }
  return args;
}

/** What a rejected push can be answered with: git's message says "fetch first" and stops, so the dialog offers the three things that actually resolve it. */
export type RejectionRemedy = 'pull-rebase' | 'pull-merge' | 'force-lease';

export interface RejectionRemedyInfo {
  remedy: RejectionRemedy;
  label: string;
  detail: string;
  danger?: boolean;
}

export const REJECTION_REMEDIES: readonly RejectionRemedyInfo[] = [
  {
    remedy: REMEDY_PULL_REBASE,
    label: 'Pull with rebase, then push',
    detail: 'Replays your commits on top. The usual answer.'
  },
  {
    remedy: REMEDY_PULL_MERGE,
    label: 'Pull with merge, then push',
    detail: 'Brings the remote work in as a merge commit.'
  },
  {
    remedy: REMEDY_FORCE_LEASE,
    label: 'Force with lease',
    detail:
      'Overwrites the remote branch.',
    danger: true
  }
];

/**
 * One remedy's entry, by name. A total lookup, not `find(...) ?? REJECTION_REMEDIES[0]`
 * at the call site: a fallback written into a dialog would be a second answer to "what does this remedy say" that nothing keeps in step with the first.
 */
export function rejectionRemedy(remedy: RejectionRemedy): RejectionRemedyInfo
{
  const found = REJECTION_REMEDIES.find((entry) => entry.remedy === remedy);
  if (!found)
  {
    throw new Error(`Unknown rejection remedy: ${remedy}`);
  }
  return found;
}

/** Whether git's stderr is the "you are behind" rejection rather than a real failure. */
export function isRejectedPush(stderr: string): boolean
{
  return /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i.test(stderr);
}
