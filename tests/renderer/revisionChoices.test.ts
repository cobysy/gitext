/**
 * The rows a revision picker offers.
 *
 * Pure, so the grouping and the filtering are checked here rather than by opening a
 * window and typing into it, which is what they were before this was extracted out of
 * `RevisionSlot.vue` for the Go to Commit dialog to share.
 */

import { describe, expect, it } from 'vitest';
import {
  revisionChoices,
  typedIsWorthShowing,
  visibleChoices,
  SHOWN_PER_KIND
} from '@renderer/model/revisionChoices.js';
import type { CommitSummary, RefEntry } from '@shared/types.js';

function ref(name: string, kind: RefEntry['kind'], extra: Partial<RefEntry> = {}): RefEntry
{
  let namespace: string;
  if (kind === 'branch')
  {
    namespace = 'heads';
  }
  else if (kind === 'tag')
  {
    namespace = 'tags';
  }
  else
  {
    namespace = 'remotes';
  }
  let remote: string | null;
  if (kind === 'remote')
  {
    remote = 'origin';
  }
  else
  {
    remote = null;
  }
  return {
    fullName: `refs/${namespace}/${name}`,
    name,
    kind,
    sha: `${name.replace(/\W/g, '')}0000000000000000000000000000000000`.slice(0, 40),
    date: 0,
    isCurrent: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    remote,
    isAnnotated: false,
    ...extra
  };
}

const REFS: RefEntry[] = [
  ref('main', 'branch', { isCurrent: true }),
  ref('feature/login', 'branch'),
  ref('origin/main', 'remote'),
  ref('v1.0.0', 'tag')
];

const SUMMARY: CommitSummary = {
  sha: 'abc1234000000000000000000000000000000000',
  subject: 'Fix the thing',
  authorName: 'Ada',
  authorDate: 1700000000
};

describe('revisionChoices', () =>
{
  it('groups the refs by kind, in the order they are drawn', () =>
  {
    const groups = revisionChoices({ refs: REFS, query: '' });
    expect(groups.map((g) => g.title)).toEqual(['Branches', 'Remote branches', 'Tags']);
  });

  it('leaves out a group nothing matches rather than drawing it empty', () =>
  {
    const groups = revisionChoices({ refs: REFS, query: 'feature' });
    // A heading over no rows says a section exists and is hiding what is in it.
    expect(groups.map((g) => g.title)).toEqual(['Branches']);
    expect(groups[0]?.items.map((c) => c.name)).toEqual(['feature/login']);
  });

  it('filters case-insensitively, on any part of the name', () =>
  {
    const groups = revisionChoices({ refs: REFS, query: 'LOGIN' });
    expect(visibleChoices(groups).map((c) => c.name)).toEqual(['feature/login']);
  });

  it('marks the checked-out branch and remembers every ref by name', () =>
  {
    const [branches] = revisionChoices({ refs: REFS, query: '' });
    const main = branches?.items.find((c) => c.name === 'main');
    expect(main?.detail).toBe('current');
    expect(main?.ref).toBe('main');
    expect(main?.sha).toBe(REFS[0]?.sha);
  });

  it('offers the working state only when asked, and never as a commit', () =>
  {
    expect(revisionChoices({ refs: REFS, query: '' }).map((g) => g.title)).not.toContain(
      'Working state'
    );

    const groups = revisionChoices({ refs: REFS, query: '', includeWorking: true });
    const working = groups.find((g) => g.title === 'Working state');
    expect(working?.items.map((c) => c.name)).toEqual(['Working tree', 'Index']);
    // Neither is a commit, so neither has a SHA to hand anybody.
    expect(working?.items.every((c) => c.sha === null)).toBe(true);
  });

  it('filters the working state by name like everything else', () =>
  {
    const groups = revisionChoices({ refs: REFS, query: 'index', includeWorking: true });
    expect(groups.find((g) => g.title === 'Working state')?.items.map((c) => c.name)).toEqual([
      'Index'
    ]);
  });

  it('puts a resolved revision at the top, above the refs', () =>
  {
    const groups = revisionChoices({ refs: REFS, query: 'abc1234', typed: SUMMARY });
    expect(groups[0]?.title).toBe('Revision');
    expect(groups[0]?.items[0]).toMatchObject({
      kind: 'revision',
      sha: SUMMARY.sha,
      detail: SUMMARY.subject
    });
  });
});

describe('visibleChoices', () =>
{
  it('flattens the groups so the keyboard walks one list', () =>
  {
    const groups = revisionChoices({ refs: REFS, query: '' });
    expect(visibleChoices(groups).map((c) => c.name)).toEqual([
      'main',
      'feature/login',
      'origin/main',
      'v1.0.0'
    ]);
  });

  it('truncates each group at the shown limit, without dropping the groups after it', () =>
  {
    const many = Array.from({ length: SHOWN_PER_KIND + 3 }, (_, i) => ref(`b${i}`, 'branch'));
    const groups = revisionChoices({ refs: [...many, ref('v9', 'tag')], query: '' });

    // The group still reports its whole size: that is what "N more" is counted from.
    expect(groups[0]?.items).toHaveLength(SHOWN_PER_KIND + 3);
    const rows = visibleChoices(groups);
    expect(rows.filter((c) => c.kind === 'branch')).toHaveLength(SHOWN_PER_KIND);
    expect(rows.at(-1)?.name).toBe('v9');
  });

  it('keys every drawn row uniquely, so a list can be rendered from it', () =>
  {
    const rows = visibleChoices(
      revisionChoices({ refs: REFS, query: '', typed: SUMMARY, includeWorking: true })
    );
    expect(new Set(rows.map((c) => c.key)).size).toBe(rows.length);
  });
});

describe('typedIsWorthShowing', () =>
{
  it('is false when nothing resolved', () =>
  {
    expect(typedIsWorthShowing(null, 'nope', REFS)).toBe(false);
  });

  it('is true for a revision no ref is named after', () =>
  {
    expect(typedIsWorthShowing(SUMMARY, 'abc1234', REFS)).toBe(true);
  });

  it('is false when a ref already carries that exact name', () =>
  {
    // Otherwise the row sits directly above the branch it duplicates, saying the same
    // thing twice.
    expect(typedIsWorthShowing(SUMMARY, 'main', REFS)).toBe(false);
    expect(typedIsWorthShowing(SUMMARY, '  main  ', REFS)).toBe(false);
  });
});
