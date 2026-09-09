import { describe, expect, it } from 'vitest';
import { LOG_FORMAT, LogParser, parseLog } from '@main/git/parse.js';
import { buildLogArgs } from '@main/git/log.js';

/** Assemble a `git log -z` payload: NUL between fields and after the last one. */
function record(fields: Partial<Record<string, string>> & { sha: string }): string
{
  const values = [
    fields.sha,
    fields.parents ?? '',
    fields.authorName ?? 'Ada',
    fields.authorEmail ?? 'ada@example.com',
    fields.authorDate ?? '1700000000',
    fields.committerName ?? 'Ada',
    fields.committerEmail ?? 'ada@example.com',
    fields.committerDate ?? '1700000001',
    fields.refs ?? '',
    fields.subject ?? 'subject',
    fields.body ?? '',
    fields.note ?? ''
  ];
  return values.join('\0') + '\0';
}

describe('LOG_FORMAT', () =>
{
  it('separates every field with NUL', () =>
  {
    expect(LOG_FORMAT.split('%x00')).toHaveLength(12);
    expect(LOG_FORMAT.startsWith('%H%x00%P')).toBe(true);
  });
});

describe('parseLog', () =>
{
  it('reads a commit into its fields', () =>
  {
    const [commit] = parseLog(
      record({ sha: 'abc', parents: 'p1 p2', subject: 'Fix the thing', authorDate: '16999999999999' })
    );

    expect(commit!.sha).toBe('abc');
    expect(commit!.parents).toEqual(['p1', 'p2']);
    expect(commit!.subject).toBe('Fix the thing');
    expect(commit!.authorDate).toBe(16999999999999);
  });

  it('treats a root commit as having no parents', () =>
  {
    const [commit] = parseLog(record({ sha: 'root', parents: '' }));
    expect(commit!.parents).toEqual([]);
  });

  it('keeps newlines inside a commit body', () =>
  {
    // The whole reason for NUL framing: a body is arbitrary text.
    const body = 'line one\nline two\n\nline four';
    const [commit] = parseLog(record({ sha: 'a', body }));

    expect(commit!.body).toBe(body);
  });

  it('reads a subject containing the field separator character in text form', () =>
  {
    const [commit] = parseLog(record({ sha: 'a', subject: 'uses %x00 in the message' }));
    expect(commit!.subject).toBe('uses %x00 in the message');
  });

  it('parses several commits in one payload', () =>
  {
    const commits = parseLog(record({ sha: 'a' }) + record({ sha: 'b' }) + record({ sha: 'c' }));
    expect(commits.map((c) => c.sha)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for empty output', () =>
  {
    expect(parseLog('')).toEqual([]);
  });
});

describe('parseLog refs', () =>
{
  it('marks the checked-out branch as current', () =>
  {
    const [commit] = parseLog(record({ sha: 'a', refs: 'HEAD -> main, origin/main' }), ['origin']);

    expect(commit!.refs[0]).toEqual({ name: 'main', kind: 'branch', isCurrent: true });
    expect(commit!.refs[1]).toEqual({ name: 'origin/main', kind: 'remote', isCurrent: false });
  });

  it('recognises tags', () =>
  {
    const [commit] = parseLog(record({ sha: 'a', refs: 'tag: v1.2.0' }));
    expect(commit!.refs[0]).toEqual({ name: 'v1.2.0', kind: 'tag', isCurrent: false });
  });

  it('recognises a detached HEAD', () =>
  {
    const [commit] = parseLog(record({ sha: 'a', refs: 'HEAD' }));
    expect(commit!.refs[0]!.kind).toBe('head');
  });

  it('does not mistake a local branch with a slash for a remote branch', () =>
  {
    // `feature/x` looks exactly like `origin/x` unless the remote list is consulted.
    const [commit] = parseLog(record({ sha: 'a', refs: 'feature/graph' }), ['origin']);
    expect(commit!.refs[0]!.kind).toBe('branch');
  });

  it('has no refs when the field is empty', () =>
  {
    const [commit] = parseLog(record({ sha: 'a', refs: '' }));
    expect(commit!.refs).toEqual([]);
  });
});

describe('LogParser incremental delivery', () =>
{
  it('yields each commit as its record completes', () =>
  {
    const parser = new LogParser();
    const first = parser.push(record({ sha: 'a' }));
    const second = parser.push(record({ sha: 'b' }));

    expect(first.map((c) => c.sha)).toEqual(['a']);
    expect(second.map((c) => c.sha)).toEqual(['b']);
  });

  it('holds back a partial record until the rest arrives', () =>
  {
    const payload = record({ sha: 'a', subject: 'split me' });
    const parser = new LogParser();

    // Cut mid-field, which is where a naive parser loses data.
    const cut = payload.indexOf('split') + 3;
    expect(parser.push(payload.slice(0, cut))).toEqual([]);

    const commits = parser.push(payload.slice(cut));
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe('split me');
  });

  it('survives being fed one character at a time', () =>
  {
    const payload = record({ sha: 'a', body: 'multi\nline' }) + record({ sha: 'b' });
    const parser = new LogParser();
    const commits = [...payload].flatMap((ch) => parser.push(ch));

    expect(commits.map((c) => c.sha)).toEqual(['a', 'b']);
    expect(commits[0]!.body).toBe('multi\nline');
  });

  it('drops a truncated trailing record rather than inventing a commit', () =>
  {
    const parser = new LogParser();
    parser.push('abc\0def\0');
    expect(parser.flush()).toEqual([]);
  });
});

describe('buildLogArgs', () =>
{
  it('defaults to date order with the NUL format', () =>
  {
    const args = buildLogArgs();

    expect(args[0]).toBe('log');
    expect(args).toContain('-z');
    expect(args).toContain('--date-order');
    expect(args.some((a) => a.startsWith('--format='))).toBe(true);
  });

  it('maps the three sort options to their flags', () =>
  {
    expect(buildLogArgs({ order: 'topo' })).toContain('--topo-order');
    expect(buildLogArgs({ order: 'author-date' })).toContain('--author-date-order');
    expect(buildLogArgs({ order: 'date' })).toContain('--date-order');
  });

  it('omits the limit entirely when unlimited', () =>
  {
    expect(buildLogArgs({ limit: null }).some((a) => a.startsWith('--max-count'))).toBe(false);
    expect(buildLogArgs({ limit: 999999 })).toContain('--max-count=999999');
  });

  it('walks every branch, tag and remote for the `all` scope', () =>
  {
    const args = buildLogArgs({ scope: 'all' });
    expect(args).toEqual(expect.arrayContaining(['--branches', '--tags', '--remotes']));
  });

  it('never passes --all, which would drag refs/stash into the history', () =>
  {
    // `--all` means every ref under refs/, so the stash's own commits ("WIP on main:")
    // would appear as ordinary commits whether or not "Show stashes" is on. There is an
    // integration test proving it against real git.
    expect(buildLogArgs({ scope: 'all' })).not.toContain('--all');
  });

  it('walks HEAD alone for the current-branch scope, and by default', () =>
  {
    for (const args of [buildLogArgs({ scope: 'current' }), buildLogArgs({})])
    {
      expect(args).not.toContain('--branches');
      expect(args).not.toContain('--all');
      // Said, not assumed: see the stash test below for what taking the assumption
      // away costs.
      expect(args).toContain('HEAD');
    }
  });

  it('lets reflog replace the scope rather than combine with it', () =>
  {
    // --reflog brings its own ref set; pairing it with the scope flags changes what is
    // walked.
    const args = buildLogArgs({ reflog: true, scope: 'all' });

    expect(args).toContain('--reflog');
    expect(args).not.toContain('--branches');
  });

  it('walks the named refs when the scope is filtered', () =>
  {
    const args = buildLogArgs({ scope: 'filtered', refs: ['main', 'origin/dev'] });
    expect(args).toContain('main');
    expect(args).toContain('origin/dev');
  });

  it('falls back to HEAD when a filtered scope names no refs', () =>
  {
    const args = buildLogArgs({ scope: 'filtered', refs: [] });
    expect(args).not.toContain('--all');
    expect(args).toContain('HEAD');
  });

  it('keeps naming HEAD when the stash glob is along for the ride', () =>
  {
    // git assumes HEAD only when the argv names nothing, and `--glob` counts as
    // something even on a repository with no stash: so a current-branch scope that left
    // HEAD unsaid asked for an empty set of refs and drew an empty grid.
    const args = buildLogArgs({ scope: 'current', includeStashes: true });
    expect(args).toContain('HEAD');
    expect(args).toContain('--glob=refs/stas[h]');
  });

  it('does not let an unborn branch turn that HEAD into a fatal error', () =>
  {
    // `git log HEAD` on a repository with no commits is fatal, where a bare `git log`
    // is merely empty. Naming HEAD must not cost that.
    expect(buildLogArgs({ scope: 'current' })).toContain('--ignore-missing');
  });

  it('does not name HEAD when a scope has already named its refs', () =>
  {
    // `--ignore-missing` would otherwise swallow a branch name that does not resolve,
    // which is the one case a filtered scope should complain about.
    for (const args of [
      buildLogArgs({ scope: 'all' }),
      buildLogArgs({ scope: 'filtered', refs: ['main'] }),
      buildLogArgs({ reflog: true })
    ])
    {
      expect(args).not.toContain('HEAD');
      expect(args).not.toContain('--ignore-missing');
    }
  });

  it('says which regex flavour it means for text filters', () =>
  {
    expect(buildLogArgs({ messageFilter: 'fix' })).toContain('--fixed-strings');
    expect(buildLogArgs({ messageFilter: 'fi.', useRegex: true })).toContain('--extended-regexp');
  });

  it('keeps a filter value in one argument, so spaces need no quoting', () =>
  {
    const args = buildLogArgs({ messageFilter: 'fix the thing' });
    expect(args).toContain('--grep=fix the thing');
  });

  it('puts paths after a double dash', () =>
  {
    const args = buildLogArgs({ paths: ['src/main.ts', 'README.md'] });
    const sep = args.indexOf('--');

    expect(sep).toBeGreaterThan(-1);
    expect(args.slice(sep + 1)).toEqual(['src/main.ts', 'README.md']);
  });

  it('separates paths that would otherwise read as refs', () =>
  {
    // A file called `main` must not be taken for the branch.
    const args = buildLogArgs({ scope: 'filtered', refs: ['main'], paths: ['main'] });
    expect(args.indexOf('--')).toBeLessThan(args.lastIndexOf('main'));
  });

  it('puts --follow before the path separator, when there is exactly one path', () =>
  {
    const args = buildLogArgs({ follow: true, paths: ['src/main.ts'] });
    const follow = args.indexOf('--follow');
    const sep = args.indexOf('--');
    expect(follow).toBeGreaterThan(-1);
    expect(follow).toBeLessThan(sep);
  });

  it('refuses --follow with anything but exactly one path', () =>
  {
    expect(() => buildLogArgs({ follow: true, paths: [] })).toThrow();
    expect(() => buildLogArgs({ follow: true, paths: ['a.ts', 'b.ts'] })).toThrow();
    expect(() => buildLogArgs({ follow: true })).toThrow();
  });

  it('asks for notes only when wanted', () =>
  {
    expect(buildLogArgs({})).not.toContain('--notes');
    expect(buildLogArgs({ notes: true })).toContain('--notes');
  });

  it('collapses merged branches with first-parent only', () =>
  {
    expect(buildLogArgs({ firstParentOnly: true })).toContain('--first-parent');
  });

  it('drops merge commits when asked', () =>
  {
    expect(buildLogArgs({ hideMergeCommits: true })).toContain('--no-merges');
    expect(buildLogArgs({})).not.toContain('--no-merges');
  });

  it('filters by committer the same way as author', () =>
  {
    const args = buildLogArgs({ committerFilter: 'ada' });
    expect(args).toContain('--committer=ada');
    expect(args).toContain('--fixed-strings');
  });

  it('includes tags and remotes in the all scope by default', () =>
  {
    const args = buildLogArgs({ scope: 'all' });
    expect(args).toContain('--tags');
    expect(args).toContain('--remotes');
  });

  it('drops tags or remotes independently when told to, without dropping the other', () =>
  {
    const noTags = buildLogArgs({ scope: 'all', includeTags: false });
    expect(noTags).not.toContain('--tags');
    expect(noTags).toContain('--remotes');
    expect(noTags).toContain('--branches');

    const noRemotes = buildLogArgs({ scope: 'all', includeRemoteBranches: false });
    expect(noRemotes).not.toContain('--remotes');
    expect(noRemotes).toContain('--tags');
  });

  it('adds the stash glob only when asked, on top of any scope', () =>
  {
    expect(buildLogArgs({})).not.toContain('--glob=refs/stas[h]');
    expect(buildLogArgs({ includeStashes: true })).toContain('--glob=refs/stas[h]');
    expect(buildLogArgs({ scope: 'current', includeStashes: true })).toContain(
      '--glob=refs/stas[h]'
    );
  });

  it('does not add the stash glob just because reflog replaced the scope', () =>
  {
    // --reflog already brings its own ref set; the stash toggle still has to say so
    // explicitly rather than piggybacking on it.
    expect(buildLogArgs({ reflog: true })).not.toContain('--glob=refs/stas[h]');
  });

  it('names a filtered branch literally when it has no wildcard', () =>
  {
    const args = buildLogArgs({ scope: 'filtered', refs: ['main', 'release-1.0'] });
    expect(args).toContain('main');
    expect(args).toContain('release-1.0');
    expect(args.some((a) => a.startsWith('--branches='))).toBe(false);
  });

  it('expands a wildcard branch filter with --branches=, not as a bare revision', () =>
  {
    // A bare `feature/*` does not resolve as a revision at all; git needs --branches=
    // to treat it as a pattern.
    const args = buildLogArgs({ scope: 'filtered', refs: ['feature/*'] });
    expect(args).toContain('--branches=feature/*');
    expect(args).not.toContain('feature/*');
  });

  it('treats a mix of literal and wildcard filtered branches independently', () =>
  {
    const args = buildLogArgs({ scope: 'filtered', refs: ['main', 'release-*'] });
    expect(args).toContain('main');
    expect(args).toContain('--branches=release-*');
  });
});
