import { describe, expect, it } from 'vitest';
import { buildLogFilterArgs } from '@renderer/model/args/logFilter.js';

/**
 * Mirrors `tests/main/log.test.ts`'s `buildLogArgs` cases for the fields this dialog's
 * form actually sets: the same pairing every other dialog's argv test has with its
 * `main/git/*` counterpart, so the two builders cannot drift apart unnoticed.
 */
describe('buildLogFilterArgs', () =>
{
  it('is empty for an empty filter', () =>
  {
    expect(buildLogFilterArgs({})).toEqual([]);
  });

  it('includes tags and remotes in the all scope by default', () =>
  {
    const args = buildLogFilterArgs({ scope: 'all' });
    expect(args).toEqual(expect.arrayContaining(['--branches', '--tags', '--remotes']));
  });

  it('drops tags or remotes independently', () =>
  {
    expect(buildLogFilterArgs({ scope: 'all', includeTags: false })).not.toContain('--tags');
    expect(
      buildLogFilterArgs({ scope: 'all', includeRemoteBranches: false })
    ).not.toContain('--remotes');
  });

  it('lets reflog replace the scope', () =>
  {
    const args = buildLogFilterArgs({ reflog: true, scope: 'all' });
    expect(args).toContain('--reflog');
    expect(args).not.toContain('--branches');
  });

  it('adds the stash glob only when asked', () =>
  {
    expect(buildLogFilterArgs({ includeStashes: true })).toContain('--glob=refs/stas[h]');
    expect(buildLogFilterArgs({})).not.toContain('--glob=refs/stas[h]');
  });

  it('names a literal filtered branch as-is and a wildcard one with --branches=', () =>
  {
    const args = buildLogFilterArgs({ scope: 'filtered', refs: ['main', 'release-*'] });
    expect(args).toContain('main');
    expect(args).toContain('--branches=release-*');
  });

  it('filters by author, committer and message with a matching regex flavour', () =>
  {
    const fixed = buildLogFilterArgs({ authorFilter: 'ada', committerFilter: 'grace' });
    expect(fixed).toEqual(expect.arrayContaining(['--fixed-strings', '--author=ada', '--committer=grace']));

    const regex = buildLogFilterArgs({ messageFilter: 'fi.', useRegex: true });
    expect(regex).toContain('--extended-regexp');
  });

  it('filters by diff content and date range', () =>
  {
    const args = buildLogFilterArgs({ diffContentFilter: 'TODO', since: '2024-01-01', until: '2024-12-31' });
    expect(args).toEqual(
      expect.arrayContaining(['-STODO', '--since=2024-01-01', '--until=2024-12-31'])
    );
  });

  it('collapses merges and follows first-parent only when asked', () =>
  {
    expect(buildLogFilterArgs({ hideMergeCommits: true })).toContain('--no-merges');
    expect(buildLogFilterArgs({ firstParentOnly: true })).toContain('--first-parent');
  });
});
