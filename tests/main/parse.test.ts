import { describe, expect, it } from 'vitest';
import {
  parseGitVersion,
  parseLsFilesStage,
  parseLsTree,
  parseRefList,
  parseRemotes,
  parseStashList,
  parseStatus,
  parseSubmoduleConfig,
  parseSubmoduleStatus,
  parseUnmergedPaths,
  parseWorktrees,
  splitNul
} from '@main/git/parse.js';

/** Build NUL-delimited output the way git emits it: every record NUL-terminated. */
const nul = (...records: string[]): string => records.map((r) => `${r}\0`).join('');

describe('splitNul', () =>
{
  it('drops the empty element left by a trailing NUL', () =>
  {
    expect(splitNul('a\0b\0')).toEqual(['a', 'b']);
  });

  it('returns an empty array for empty output', () =>
  {
    expect(splitNul('')).toEqual([]);
  });

  it('preserves empty records that are not trailing', () =>
  {
    expect(splitNul('a\0\0b\0')).toEqual(['a', '', 'b']);
  });
});

describe('parseGitVersion', () =>
{
  it('parses a vendor-suffixed version', () =>
  {
    expect(parseGitVersion('git version 2.50.1 (Apple Git-155)')).toMatchObject({
      major: 2,
      minor: 50,
      patch: 1
    });
  });

  it('defaults a missing patch to zero', () =>
  {
    expect(parseGitVersion('git version 2.39')).toMatchObject({ major: 2, minor: 39, patch: 0 });
  });

  it('returns null for unrecognised output', () =>
  {
    expect(parseGitVersion('command not found')).toBeNull();
  });
});

describe('parseStatus', () =>
{
  it('reads branch, upstream and ahead/behind from the header', () =>
  {
    const status = parseStatus(
      nul(
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +3 -2'
      )
    );
    expect(status).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 3,
      behind: 2
    });
  });

  it('reports a detached HEAD as a null branch', () =>
  {
    expect(parseStatus(nul('# branch.head (detached)')).branch).toBeNull();
  });

  it('classifies staged and unstaged ordinary changes', () =>
  {
    // "M." = staged modification; ".M" = unstaged modification.
    const status = parseStatus(
      nul(
        '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
        '1 .M N... 100644 100644 100644 ccc ddd unstaged.ts'
      )
    );

    expect(status.files).toEqual([
      expect.objectContaining({ path: 'staged.ts', staged: true, unstaged: false }),
      expect.objectContaining({ path: 'unstaged.ts', staged: false, unstaged: true })
    ]);
  });

  it('pairs a rename with its original path from the next record', () =>
  {
    const status = parseStatus(
      nul('2 R. N... 100644 100644 100644 aaa bbb R100 new/path.ts', 'old/path.ts')
    );

    expect(status.files).toEqual([
      expect.objectContaining({ path: 'new/path.ts', origPath: 'old/path.ts', index: 'renamed' })
    ]);
  });

  it('does not mistake the rename original for a separate file', () =>
  {
    const status = parseStatus(
      nul('2 R. N... 100644 100644 100644 aaa bbb R100 new.ts', 'old.ts', '? untracked.ts')
    );

    expect(status.files.map((f) => f.path)).toEqual(['new.ts', 'untracked.ts']);
  });

  it('marks unmerged entries as conflicted', () =>
  {
    const status = parseStatus(
      nul('u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.ts')
    );

    expect(status.files[0]).toMatchObject({
      path: 'conflicted.ts',
      index: 'conflicted',
      worktree: 'conflicted'
    });
  });

  it('distinguishes untracked from ignored', () =>
  {
    const status = parseStatus(nul('? new.ts', '! build/out.js'));
    expect(status.files).toEqual([
      expect.objectContaining({ path: 'new.ts', worktree: 'untracked' }),
      expect.objectContaining({ path: 'build/out.js', worktree: 'ignored' })
    ]);
  });

  it('keeps spaces in paths intact', () =>
  {
    const status = parseStatus(nul('1 .M N... 100644 100644 100644 aaa bbb my folder/a file.ts'));
    expect(status.files[0]?.path).toBe('my folder/a file.ts');
  });

  it('flags submodule entries', () =>
  {
    const status = parseStatus(nul('1 .M S.M. 160000 160000 160000 aaa bbb deps/lib'));
    expect(status.files[0]?.isSubmodule).toBe(true);
  });

  it('returns an empty file list for a clean tree', () =>
  {
    expect(parseStatus(nul('# branch.head main')).files).toEqual([]);
  });
});

describe('parseUnmergedPaths', () =>
{
  it('collapses the three stage entries of one conflict into one path', () =>
  {
    const text = nul(
      '100644 aaa 1\tsrc/a.ts',
      '100644 bbb 2\tsrc/a.ts',
      '100644 ccc 3\tsrc/a.ts',
      '100644 ddd 2\tsrc/b.ts'
    );
    expect(parseUnmergedPaths(text)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns an empty array when nothing is unmerged', () =>
  {
    expect(parseUnmergedPaths('')).toEqual([]);
  });
});

describe('parseLsTree', () =>
{
  it('reads mode, type and path out of each record', () =>
  {
    const text = nul(
      '100644 blob aaa\tREADME.md',
      '100755 blob bbb\tscripts/build.sh',
      '120000 blob ccc\tlink'
    );
    expect(parseLsTree(text)).toEqual([
      { path: 'README.md', kind: 'blob', mode: '100644' },
      { path: 'scripts/build.sh', kind: 'blob', mode: '100755' },
      { path: 'link', kind: 'blob', mode: '120000' }
    ]);
  });

  // git's own word for a gitlink in a tree listing, which is not a file to open.
  it('reads a commit entry as a submodule', () =>
  {
    expect(parseLsTree(nul('160000 commit ddd\texternals/lib'))).toEqual([
      { path: 'externals/lib', kind: 'submodule', mode: '160000' }
    ]);
  });

  // `-r` should mean none arrive; one that did would draw beside the folder the paths
  // already imply, so it is dropped rather than trusted.
  it('drops a folder entry', () =>
  {
    expect(parseLsTree(nul('040000 tree eee\tsrc', '100644 blob fff\tsrc/a.ts'))).toEqual([
      { path: 'src/a.ts', kind: 'blob', mode: '100644' }
    ]);
  });

  it('keeps a path holding a newline in one piece', () =>
  {
    expect(parseLsTree(nul('100644 blob aaa\tweird\nname.txt'))[0]!.path).toBe('weird\nname.txt');
  });

  it('returns an empty array for an empty tree', () =>
  {
    expect(parseLsTree('')).toEqual([]);
  });
});

describe('parseLsFilesStage', () =>
{
  it('reads the mode and the path, ignoring the stage number', () =>
  {
    const text = nul('100644 aaa 0\tsrc/a.ts', '160000 bbb 0\texternals/lib');
    expect(parseLsFilesStage(text)).toEqual([
      { path: 'src/a.ts', kind: 'blob', mode: '100644' },
      { path: 'externals/lib', kind: 'submodule', mode: '160000' }
    ]);
  });

  // A conflict puts the same path in the index three times; the list is a list of files.
  it('lists a conflicted path once', () =>
  {
    const text = nul('100644 aaa 1\tsrc/a.ts', '100644 bbb 2\tsrc/a.ts', '100644 ccc 3\tsrc/a.ts');
    expect(parseLsFilesStage(text).map((entry) => entry.path)).toEqual(['src/a.ts']);
  });

  it('returns an empty array for an empty index', () =>
  {
    expect(parseLsFilesStage('')).toEqual([]);
  });
});

/** One `for-each-ref` record: fields NUL-separated, the record newline-terminated. */
const refLine = (...fields: string[]): string => `${fields.join('\0')}\n`;

/** A `git config --null` entry: key and value separated by a newline, NUL-terminated. */
const configEntry = (key: string, value: string): string => `${key}\n${value}\0`;

describe('parseRefList', () =>
{
  it('reads a local branch with its upstream and ahead/behind counts', () =>
  {
    const text = refLine(
      'refs/heads/main',
      'commit',
      'aaa111',
      '',
      '1700000000',
      '',
      'origin/main',
      'ahead 2, behind 3',
      '*'
    );
    expect(parseRefList(text, ['origin'])).toEqual([
      {
        fullName: 'refs/heads/main',
        name: 'main',
        kind: 'branch',
        sha: 'aaa111',
        date: 1700000000,
        isCurrent: true,
        upstream: 'origin/main',
        ahead: 2,
        behind: 3,
        upstreamGone: false,
        remote: null,
        isAnnotated: false
      }
    ]);
  });

  it('reads ahead-only and behind-only tracking', () =>
  {
    const ahead = refLine('refs/heads/a', 'commit', 'a', '', '1', '', 'origin/a', 'ahead 5', ' ');
    const behind = refLine('refs/heads/b', 'commit', 'b', '', '1', '', 'origin/b', 'behind 4', ' ');
    const [a, b] = parseRefList(ahead + behind);
    expect([a?.ahead, a?.behind]).toEqual([5, 0]);
    expect([b?.ahead, b?.behind]).toEqual([0, 4]);
  });

  it('flags a branch whose upstream has been deleted', () =>
  {
    const text = refLine('refs/heads/old', 'commit', 'a', '', '1', '', 'origin/old', 'gone', ' ');
    expect(parseRefList(text)[0]).toMatchObject({ upstream: 'origin/old', upstreamGone: true });
  });

  it('peels an annotated tag to the commit it tags', () =>
  {
    const text = refLine('refs/tags/v1', 'tag', 'tagobj', 'commitsha', '', '1700000500', '', '', ' ');
    expect(parseRefList(text)[0]).toMatchObject({
      name: 'v1',
      kind: 'tag',
      sha: 'commitsha',
      date: 1700000500,
      isAnnotated: true
    });
  });

  it('reads a lightweight tag straight off the commit', () =>
  {
    const text = refLine('refs/tags/v0', 'commit', 'commitsha', '', '1700000400', '', '', '', ' ');
    expect(parseRefList(text)[0]).toMatchObject({
      sha: 'commitsha',
      date: 1700000400,
      isAnnotated: false
    });
  });

  it('splits a remote branch at the configured remote, not the first slash', () =>
  {
    const text =
      refLine('refs/remotes/origin/feature/x', 'commit', 'a', '', '1', '', '', '', ' ') +
      refLine('refs/remotes/origin/mirror/main', 'commit', 'b', '', '1', '', '', '', ' ');
    const entries = parseRefList(text, ['origin', 'origin/mirror']);
    expect(entries.map((e) => [e.name, e.remote])).toEqual([
      ['origin/feature/x', 'origin'],
      ['origin/mirror/main', 'origin/mirror']
    ]);
  });

  it('falls back to the first path segment when the remote list is unknown', () =>
  {
    const text = refLine('refs/remotes/origin/main', 'commit', 'a', '', '1', '', '', '', ' ');
    expect(parseRefList(text)[0]?.remote).toBe('origin');
  });

  it("drops a remote's HEAD symref, which names a branch rather than being one", () =>
  {
    const text =
      refLine('refs/remotes/origin/HEAD', 'commit', 'a', '', '1', '', '', '', ' ') +
      refLine('refs/remotes/origin/main', 'commit', 'a', '', '1', '', '', '', ' ');
    expect(parseRefList(text, ['origin']).map((e) => e.name)).toEqual(['origin/main']);
  });

  it('ignores refs outside heads, remotes and tags', () =>
  {
    const text = refLine('refs/notes/commits', 'commit', 'a', '', '1', '', '', '', ' ');
    expect(parseRefList(text)).toEqual([]);
  });

  it('returns nothing for a repository with no refs', () =>
  {
    expect(parseRefList('')).toEqual([]);
  });
});

describe('parseRemotes', () =>
{
  it('pairs fetch and push URLs per remote', () =>
  {
    const text =
      configEntry('remote.origin.url', 'git@example.com:a/b.git') +
      configEntry('remote.origin.pushurl', 'git@push.example.com:a/b.git') +
      configEntry('remote.upstream.url', 'https://example.com/c/d.git');
    expect(parseRemotes(text)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'git@example.com:a/b.git',
        pushUrl: 'git@push.example.com:a/b.git',
        disabled: false
      },
      {
        name: 'upstream',
        fetchUrl: 'https://example.com/c/d.git',
        pushUrl: 'https://example.com/c/d.git',
        disabled: false
      }
    ]);
  });

  it('keeps the first of several fetch URLs, which is the one git fetches from', () =>
  {
    const text =
      configEntry('remote.origin.url', 'first') + configEntry('remote.origin.url', 'second');
    expect(parseRemotes(text)[0]?.fetchUrl).toBe('first');
  });

  it('handles a remote name containing a dot', () =>
  {
    expect(parseRemotes(configEntry('remote.my.remote.url', 'u'))[0]?.name).toBe('my.remote');
  });

  it('ignores other remote config keys', () =>
  {
    const text =
      configEntry('remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*') +
      configEntry('remote.origin.url', 'u');
    expect(parseRemotes(text)).toEqual([
      { name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }
    ]);
  });

  // A deactivated remote's whole section is spelled `-remote.<name>`. It has to come back
  // from this read or the panel cannot show it, and a remote that is not shown cannot be
  // switched on again.
  it('reads a deactivated remote, and marks it as one', () =>
  {
    const text =
      configEntry('-remote.fork.url', 'https://example.com/fork.git') +
      configEntry('remote.origin.url', 'u');
    expect(parseRemotes(text)).toEqual([
      { name: 'fork', fetchUrl: 'https://example.com/fork.git', pushUrl: 'https://example.com/fork.git', disabled: true },
      { name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }
    ]);
  });

  // Both spellings for one name: a remote deactivated here, then re-added from the command
  // line. git obeys the enabled section, so that is what this must report.
  it('treats a remote with both sections as active', () =>
  {
    const text =
      configEntry('-remote.origin.url', 'old') + configEntry('remote.origin.url', 'new');
    expect(parseRemotes(text)[0]).toMatchObject({ name: 'origin', disabled: false });
  });
});

describe('parseStashList', () =>
{
  it('reads the stack, newest first, with the branch parsed out', () =>
  {
    const text = nul(
      'stash@{0}',
      'aaa',
      '1700000000',
      'WIP on main: 01419fc first',
      'stash@{1}',
      'bbb',
      '1699999999',
      'On feature/x: my message'
    );
    expect(parseStashList(text)).toEqual([
      {
        index: 0,
        name: 'stash@{0}',
        sha: 'aaa',
        date: 1700000000,
        message: 'WIP on main: 01419fc first',
        branch: 'main'
      },
      {
        index: 1,
        name: 'stash@{1}',
        sha: 'bbb',
        date: 1699999999,
        message: 'On feature/x: my message',
        branch: 'feature/x'
      }
    ]);
  });

  it('keeps a message containing a newline in one entry', () =>
  {
    const text = nul('stash@{0}', 'aaa', '1', 'On main: line one\nline two');
    const entries = parseStashList(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('On main: line one\nline two');
  });

  it('leaves the branch null when the message is not one git wrote', () =>
  {
    expect(parseStashList(nul('stash@{0}', 'aaa', '1', 'hand written'))[0]?.branch).toBeNull();
  });

  it('drops a truncated trailing record rather than inventing fields', () =>
  {
    expect(parseStashList(nul('stash@{0}', 'aaa'))).toEqual([]);
  });

  it('returns nothing when the stash is empty', () =>
  {
    expect(parseStashList('')).toEqual([]);
  });
});

describe('parseWorktrees', () =>
{
  it('reads the main worktree and a linked one', () =>
  {
    const text = 'worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /wt\0HEAD def\0branch refs/heads/feature/x\0\0';
    expect(parseWorktrees(text)).toEqual([
      {
        path: '/repo',
        head: 'abc',
        branch: 'main',
        isBare: false,
        isDetached: false,
        isLocked: false,
        lockReason: '',
        prunable: false,
        isMain: true
      },
      {
        path: '/wt',
        head: 'def',
        branch: 'feature/x',
        isBare: false,
        isDetached: false,
        isLocked: false,
        lockReason: '',
        prunable: false,
        isMain: false
      }
    ]);
  });

  it('reads the valueless attributes', () =>
  {
    const text = 'worktree /bare\0bare\0\0worktree /wt\0HEAD abc\0detached\0locked\0prunable gitdir file points to non-existent location\0\0';
    const [bare, linked] = parseWorktrees(text);
    expect(bare).toMatchObject({ isBare: true, branch: null });
    expect(linked).toMatchObject({
      isDetached: true,
      isLocked: true,
      lockReason: '',
      prunable: true
    });
  });

  it('keeps a lock reason', () =>
  {
    const text = 'worktree /wt\0HEAD abc\0locked on a removable drive\0\0';
    expect(parseWorktrees(text)[0]?.lockReason).toBe('on a removable drive');
  });

  it('parses a path containing a newline, which is why -z is used', () =>
  {
    const text = 'worktree /wt/two\nlines\0HEAD abc\0\0';
    expect(parseWorktrees(text)[0]?.path).toBe('/wt/two\nlines');
  });
});

describe('parseSubmoduleConfig', () =>
{
  it('reads name, path, url and tracked branch', () =>
  {
    const text =
      configEntry('submodule.lib.path', 'deps/lib') +
      configEntry('submodule.lib.url', 'https://example.com/lib.git') +
      configEntry('submodule.lib.branch', 'main') +
      configEntry('submodule.other.path', 'vendor/other') +
      configEntry('submodule.other.url', '../other.git');
    expect(parseSubmoduleConfig(text)).toEqual([
      { name: 'lib', path: 'deps/lib', url: 'https://example.com/lib.git', branch: 'main' },
      { name: 'other', path: 'vendor/other', url: '../other.git', branch: null }
    ]);
  });

  it('drops a section with no path, which git would not act on either', () =>
  {
    expect(parseSubmoduleConfig(configEntry('submodule.lib.url', 'u'))).toEqual([]);
  });

  it('returns nothing when there is no .gitmodules content', () =>
  {
    expect(parseSubmoduleConfig('')).toEqual([]);
  });
});

describe('parseSubmoduleStatus', () =>
{
  it('reads the state character in front of each line', () =>
  {
    const text = [
      ' abc123 vendor/lib (v1.2-3-gabc)',
      '-def456 vendor/other',
      '+aaa111 vendor/moved (heads/main)',
      'Ubbb222 vendor/conflicted'
    ].join('\n');

    expect(parseSubmoduleStatus(text)).toEqual([
      { path: 'vendor/lib', sha: 'abc123', described: 'v1.2-3-gabc', state: 'current' },
      { path: 'vendor/other', sha: 'def456', described: '', state: 'uninitialized' },
      { path: 'vendor/moved', sha: 'aaa111', described: 'heads/main', state: 'different-commit' },
      { path: 'vendor/conflicted', sha: 'bbb222', described: '', state: 'conflicted' }
    ]);
  });

  it('is empty for a repository with no submodules', () =>
  {
    expect(parseSubmoduleStatus('')).toEqual([]);
    expect(parseSubmoduleStatus('\n')).toEqual([]);
  });

  it('keeps a path with spaces in it, and drops only git’s own annotation', () =>
  {
    expect(parseSubmoduleStatus(' abc123 vendor/my lib (v1)')[0]).toEqual({
      path: 'vendor/my lib',
      sha: 'abc123',
      described: 'v1',
      state: 'current'
    });
  });
});
