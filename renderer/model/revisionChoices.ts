/**
 * The rows a revision picker offers, filtered by what has been typed. Pure and DOM-free
 * so the grouping is a unit test. A choice carries the *commit* it stands for, not a
 * `DiffEndpoint`: the compare dialog builds an endpoint, Go to Commit wants a SHA to select, and a picker that knew about diff endpoints couldn't serve the second.
 */

import type { CommitSummary, RefEntry } from '@shared/types.js';

// Revision choice kinds
const CHOICE_KIND_REVISION = 'revision';
const CHOICE_KIND_WORKING_TREE = 'workingTree';
const CHOICE_KIND_INDEX = 'index';
const CHOICE_KIND_BRANCH = 'branch';
const CHOICE_KIND_REMOTE = 'remote';
const CHOICE_KIND_TAG = 'tag';

// Fixed row keys for the two non-ref choices
const KEY_WORKING_TREE = 'wt';
const KEY_INDEX = 'ix';

/** Which list a row came from: the group heading it is drawn under, and its meaning. */
export type RevisionChoiceKind = 'revision' | 'workingTree' | 'index' | 'branch' | 'remote' | 'tag';

export interface RevisionChoice {
  /** Unique within one list, so it is usable as a `:key`. */
  key: string;
  /** What the row reads. */
  name: string;
  /** The right-hand note: `current` on the checked-out branch, a subject on a revision. */
  detail?: string;
  kind: RevisionChoiceKind;
  /** The commit this resolves to, or `null` for the working tree and index, which are not commits and have no SHA to hand anybody. */
  sha: string | null;
  /** The ref name worth remembering, for a choice that is one. Absent on the rest. */
  ref?: string;
}

export interface RevisionChoiceGroup {
  title: string;
  kind: RevisionChoiceKind;
  items: RevisionChoice[];
}

export interface RevisionChoiceOptions {
  /** Every ref the repository has: `repoObjects.refs`. */
  refs: readonly RefEntry[];
  /** What has been typed into the filter box. */
  query: string;
  /** What the typed text resolved to, when worth offering as a row of its own (the SHA-out-of-a-bug-report case). Null when nothing was typed or already named by a ref below. */
  typed?: CommitSummary | null;
  /** Offer the working tree and the index as choices. The compare dialog compares them; Go to Commit can't go to one, so it doesn't ask for them. */
  includeWorking?: boolean;
}

/** How many of each kind to draw before the group says how many are left. */
export const SHOWN_PER_KIND = 6;

const REF_GROUPS: readonly { title: string; kind: 'branch' | 'remote' | 'tag' }[] = [
  { title: 'Branches', kind: CHOICE_KIND_BRANCH },
  { title: 'Remote branches', kind: CHOICE_KIND_REMOTE },
  { title: 'Tags', kind: CHOICE_KIND_TAG }
];

function matches(text: string, query: string): boolean
{
  return !query || text.toLowerCase().includes(query);
}

/** Every group with something in it, in the order they're drawn. Groups filtered down to nothing are left out rather than drawn empty. */
export function revisionChoices(options: RevisionChoiceOptions): RevisionChoiceGroup[]
{
  const query = options.query.trim().toLowerCase();
  const groups: RevisionChoiceGroup[] = [];

  if (options.typed)
  {
    groups.push({
      title: 'Revision',
      kind: CHOICE_KIND_REVISION,
      items: [
        {
          key: `rev:${options.typed.sha}`,
          name: options.typed.sha,
          detail: options.typed.subject,
          kind: CHOICE_KIND_REVISION,
          sha: options.typed.sha
        }
      ]
    });
  }

  if (options.includeWorking)
  {
    const working = ([
      { key: KEY_WORKING_TREE, name: 'Working tree', kind: CHOICE_KIND_WORKING_TREE, sha: null },
      { key: KEY_INDEX, name: 'Index', kind: CHOICE_KIND_INDEX, sha: null }
    ] satisfies RevisionChoice[]).filter((choice) => matches(choice.name, query));
    if (working.length)
    {
      groups.push({ title: 'Working state', kind: CHOICE_KIND_WORKING_TREE, items: working });
    }
  }

  for (const group of REF_GROUPS)
  {
    const items = options.refs
      .filter((ref) => ref.kind === group.kind && matches(ref.name, query))
      .map<RevisionChoice>((ref) =>
      {
        let detail: string | undefined;
        if (ref.isCurrent)
        {
          detail = 'current';
        }
        else
        {
          detail = undefined;
        }
        return {
          key: ref.fullName,
          name: ref.name,
          detail,
          kind: group.kind,
          sha: ref.sha,
          ref: ref.name
        };
      });
    if (items.length)
    {
      groups.push({ title: group.title, kind: group.kind, items });
    }
  }

  return groups;
}

/** The rows actually drawn, in order: each group truncated to `SHOWN_PER_KIND`. Flat, since the keyboard walks rows, not groups: Down off the bottom of Branches lands on the first remote branch. */
export function visibleChoices(groups: readonly RevisionChoiceGroup[]): RevisionChoice[]
{
  return groups.flatMap((group) => group.items.slice(0, SHOWN_PER_KIND));
}

/** Whether a typed revision is worth a row of its own: not when a ref is already named by exactly that text, which would sit above the branch it duplicates. */
export function typedIsWorthShowing(
  found: CommitSummary | null,
  query: string,
  refs: readonly RefEntry[]
): boolean
{
  const text = query.trim();
  return Boolean(found) && !refs.some((ref) => ref.name === text);
}
