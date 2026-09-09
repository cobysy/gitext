/**
 * The diff pivot: what a selection means, and what argv it becomes.
 *
 * The endpoint-to-argv table is the whole of the subtlety in `shared/diff.ts`: half
 * its cases are a plain `git diff` distinguished only by a `--cached` or a `-R`, and
 * getting one of them backwards produces a diff that looks plausible and is inside
 * out. That is exactly the kind of thing a table-driven unit test pins and a screenshot
 * does not.
 */

import { describe, expect, it } from 'vitest';
import { INDEX_SHA, WORKING_TREE_SHA } from '@shared/artificial.js';
import {
  buildDiffArgs,
  buildUntrackedPatchArgs,
  describeRange,
  rangeForSelection,
  sameEndpoint,
  type DiffEndpoint,
  type DiffRange
} from '@shared/diff.js';
import { parseDiffRaw } from '@main/git/parse.js';

const commit = (sha: string): DiffEndpoint => ({ kind: 'commit', sha });
const index: DiffEndpoint = { kind: 'index' };
const workingTree: DiffEndpoint = { kind: 'workingTree' };

/** Strip the flags that are the same on every call, leaving the shape of the command. */
const shape = (range: DiffRange): string[] =>
  buildDiffArgs(range, 'names').filter(
    (arg) => !['--raw', '--numstat', '-z', '--find-renames'].includes(arg)
  );

describe('buildDiffArgs', () =>
{
  it('asks diff-tree for a root commit, because there is no parent to name', () =>
  {
    expect(shape({ from: null, to: commit('abc') })).toEqual([
      'diff-tree',
      '--root',
      '-r',
      '--no-commit-id',
      'abc'
    ]);
  });

  it('asks for the index alone when the branch is unborn', () =>
  {
    // `git diff --cached` with no revision resolves an unborn HEAD to the empty tree,
    // so everything staged reads as added, which is what it is.
    expect(shape({ from: null, to: index })).toEqual(['diff', '--cached']);
  });

  it('names both commits, oldest first', () =>
  {
    expect(shape({ from: commit('old'), to: commit('new') })).toEqual(['diff', 'old', 'new']);
  });

  it('compares a commit against the index with --cached', () =>
  {
    expect(shape({ from: commit('abc'), to: index })).toEqual(['diff', '--cached', 'abc']);
  });

  it('compares a commit against the working tree with no --cached', () =>
  {
    expect(shape({ from: commit('abc'), to: workingTree })).toEqual(['diff', 'abc']);
  });

  it('is a bare `git diff` from the index to the working tree', () =>
  {
    expect(shape({ from: index, to: workingTree })).toEqual(['diff']);
  });

  it('reverses with -R rather than swapping the endpoints', () =>
  {
    // Swapping them silently would show the working tree's own lines as *deletions*,
    // which is precisely backwards for "compare the working tree to this commit".
    expect(shape({ from: workingTree, to: commit('abc') })).toEqual(['diff', '-R', 'abc']);
    expect(shape({ from: index, to: commit('abc') })).toEqual(['diff', '--cached', '-R', 'abc']);
    expect(shape({ from: workingTree, to: index })).toEqual(['diff', '-R']);
  });

  it('refuses a range whose ends are the same thing', () =>
  {
    expect(() => buildDiffArgs({ from: index, to: index }, 'names')).toThrow(/two different/);
    expect(() => buildDiffArgs({ from: commit('a'), to: commit('a') }, 'names')).toThrow();
    // Nothing precedes the working tree, so there is no "against nothing" for it.
    expect(() => buildDiffArgs({ from: null, to: workingTree }, 'names')).toThrow(/nothing/);
  });

  it('carries the whitespace and context options as git flags', () =>
  {
    const args = buildDiffArgs({ from: commit('a'), to: commit('b') }, 'patch', {
      ignoreWhitespace: 'all',
      contextLines: 8
    });
    expect(args).toContain('--ignore-all-space');
    expect(args).toContain('--unified=8');
    expect(args).toContain('--no-ext-diff');
  });

  it('puts paths after a -- so a file named like a ref stays a file', () =>
  {
    const args = buildDiffArgs({ from: commit('a'), to: commit('b') }, 'patch', {
      paths: ['main']
    });
    expect(args.slice(-2)).toEqual(['--', 'main']);
  });

  it('shows an untracked file as an addition against /dev/null', () =>
  {
    expect(buildUntrackedPatchArgs('new.txt')).toEqual([
      'diff',
      '--no-index',
      '--unified=3',
      '--no-ext-diff',
      '--',
      '/dev/null',
      'new.txt'
    ]);
  });
});

describe('sameEndpoint', () =>
{
  it('compares by kind, and by SHA for commits', () =>
  {
    expect(sameEndpoint(index, index)).toBe(true);
    expect(sameEndpoint(index, workingTree)).toBe(false);
    expect(sameEndpoint(commit('a'), commit('a'))).toBe(true);
    expect(sameEndpoint(commit('a'), commit('b'))).toBe(false);
    expect(sameEndpoint(null, null)).toBe(true);
    expect(sameEndpoint(null, index)).toBe(false);
  });
});

describe('rangeForSelection', () =>
{
  const parents: Record<string, string> = { child: 'parent' };
  const firstParentOf = (sha: string): string | null => parents[sha] ?? null;

  it('is nothing with nothing selected', () =>
  {
    expect(rangeForSelection([], firstParentOf)).toBeNull();
  });

  it('compares one commit against its first parent', () =>
  {
    expect(rangeForSelection(['child'], firstParentOf)).toEqual({
      from: commit('parent'),
      to: commit('child')
    });
  });

  it('compares a root commit against nothing', () =>
  {
    expect(rangeForSelection(['root'], firstParentOf)).toEqual({
      from: null,
      to: commit('root')
    });
  });

  it('reads the working-tree row as what is *not* staged', () =>
  {
    // Not against HEAD: the row sits above the index row in the grid, and between them
    // the two account for every change exactly once.
    expect(rangeForSelection([WORKING_TREE_SHA], firstParentOf)).toEqual({
      from: index,
      to: workingTree
    });
  });

  it('reads the index row as what is staged', () =>
  {
    expect(rangeForSelection([INDEX_SHA], firstParentOf)).toEqual({ from: null, to: index });
  });

  it('takes the first pick as the base and the last as the compared', () =>
  {
    // Click order, not row order: ctrl-clicking A then B reads left to right as "what B
    // did to A", whichever way round the grid drew them.
    expect(rangeForSelection(['a', 'b'], firstParentOf)).toEqual({
      from: commit('a'),
      to: commit('b')
    });
    expect(rangeForSelection(['b', 'a'], firstParentOf)).toEqual({
      from: commit('b'),
      to: commit('a')
    });
  });

  it('spans the whole selection when more than two are picked', () =>
  {
    expect(rangeForSelection(['a', 'b', 'c'], firstParentOf)).toEqual({
      from: commit('a'),
      to: commit('c')
    });
  });

  it('falls back to the last pick alone when both ends are the same row', () =>
  {
    // Reachable through the artificial rows: picking the working-tree row twice in a
    // selection would otherwise build a range with no meaning and throw at the argv.
    expect(rangeForSelection([WORKING_TREE_SHA, WORKING_TREE_SHA], firstParentOf)).toEqual({
      from: index,
      to: workingTree
    });
  });
});

describe('describeRange', () =>
{
  const short = (sha: string): string => sha.slice(0, 7);

  it('names the artificial ends rather than showing their sentinel SHAs', () =>
  {
    expect(describeRange({ from: index, to: workingTree }, short)).toBe(
      'the index → the working directory'
    );
    expect(describeRange({ from: null, to: index }, short)).toBe('the empty tree → the index');
    expect(describeRange({ from: commit('abcdef1234'), to: workingTree }, short)).toBe(
      'abcdef1 → the working directory'
    );
  });
});

describe('parseDiffRaw', () =>
{
  /** A `--raw` record: the metadata field and the path (or paths) after it. */
  const raw = (meta: string, ...paths: string[]): string => [meta, ...paths].join('\0') + '\0';
  /** A `--numstat` record; a rename puts its two paths in the fields after the counts. */
  const numstat = (added: string, deleted: string, ...paths: string[]): string =>
  {
    if (paths.length === 1)
    {
      return `${added}\t${deleted}\t${paths[0]}\0`;
    }
    else
    {
      return `${added}\t${deleted}\t\0${paths.join('\0')}\0`;
    }
  };

  it('reads a mode, a status letter and a path per record', () =>
  {
    const text =
      raw(':100644 100644 aaaaaaa bbbbbbb M', 'src/a.ts') +
      raw(':000000 100644 0000000 ccccccc A', 'src/b.ts') +
      raw(':100644 000000 ddddddd 0000000 D', 'src/c.ts') +
      numstat('1', '1', 'src/a.ts') +
      numstat('4', '0', 'src/b.ts') +
      numstat('0', '9', 'src/c.ts');

    expect(parseDiffRaw(text)).toEqual([
      {
        path: 'src/a.ts',
        status: 'modified',
        score: 0,
        kind: 'blob',
        mode: '100644',
        binary: false,
        lines: { added: 1, deleted: 1 }
      },
      {
        path: 'src/b.ts',
        status: 'added',
        score: 0,
        kind: 'blob',
        mode: '100644',
        binary: false,
        lines: { added: 4, deleted: 0 }
      },
      // A deletion's newer mode is `000000`, so the mode kept is the one it had.
      {
        path: 'src/c.ts',
        status: 'deleted',
        score: 0,
        kind: 'blob',
        mode: '100644',
        binary: false,
        lines: { added: 0, deleted: 9 }
      }
    ]);
  });

  it('reads a rename as one entry with two paths and a score', () =>
  {
    // The extra path is why neither section can be read as fixed-size groups.
    const text =
      raw(':100644 100644 aaaaaaa bbbbbbb R100', 'old.ts', 'new.ts') +
      raw(':100644 100644 ccccccc ddddddd M', 'other.ts') +
      numstat('0', '0', 'old.ts', 'new.ts') +
      numstat('2', '1', 'other.ts');

    expect(parseDiffRaw(text)).toEqual([
      {
        path: 'new.ts',
        origPath: 'old.ts',
        status: 'renamed',
        score: 100,
        kind: 'blob',
        mode: '100644',
        binary: false,
        lines: { added: 0, deleted: 0 }
      },
      {
        path: 'other.ts',
        status: 'modified',
        score: 0,
        kind: 'blob',
        mode: '100644',
        binary: false,
        lines: { added: 2, deleted: 1 }
      }
    ]);
  });

  it('reads a copy the same way', () =>
  {
    expect(parseDiffRaw(raw(':100644 100644 aaaaaaa bbbbbbb C75', 'from.ts', 'to.ts'))).toEqual([
      {
        path: 'to.ts',
        origPath: 'from.ts',
        status: 'copied',
        score: 75,
        kind: 'blob',
        mode: '100644',
        binary: false
      }
    ]);
  });

  it('calls a file binary when git reported no line counts for it', () =>
  {
    const text =
      raw(':100644 100644 aaaaaaa bbbbbbb M', 'logo.png') +
      raw(':100644 100644 ccccccc ddddddd M', 'notes.txt') +
      numstat('-', '-', 'logo.png') +
      numstat('3', '2', 'notes.txt');

    // And a binary file has no counts to draw: `-` is not zero lines changed.
    expect(parseDiffRaw(text).map((file) => [file.path, file.binary, file.lines])).toEqual([
      ['logo.png', true, undefined],
      ['notes.txt', false, { added: 3, deleted: 2 }]
    ]);
  });

  it('reads a gitlink as a submodule rather than as a file', () =>
  {
    const text =
      raw(':160000 160000 aaaaaaa bbbbbbb M', 'vendor/lib') +
      numstat('1', '1', 'vendor/lib');

    expect(parseDiffRaw(text)).toEqual([
      {
        path: 'vendor/lib',
        status: 'modified',
        score: 0,
        kind: 'submodule',
        mode: '160000',
        binary: false,
        lines: { added: 1, deleted: 1 }
      }
    ]);
  });

  it('reads a combined record from the ends, so the modes still bracket the change', () =>
  {
    // A merge shown against both parents: one extra `:`, one extra mode and sha.
    const text = raw('::100644 100644 100644 aaaaaaa bbbbbbb ccccccc MM', 'merged.ts');
    expect(parseDiffRaw(text)).toEqual([
      { path: 'merged.ts', status: 'modified', score: 0, kind: 'blob', mode: '100644', binary: false }
    ]);
  });

  it('keeps a path containing a newline whole', () =>
  {
    // The reason for `-z`: splitting on newlines would make this two broken records.
    expect(parseDiffRaw(raw(':100644 100644 aaaaaaa bbbbbbb M', 'od\nd.txt'))).toEqual([
      { path: 'od\nd.txt', status: 'modified', score: 0, kind: 'blob', mode: '100644', binary: false }
    ]);
  });

  it('is empty for an empty diff', () =>
  {
    expect(parseDiffRaw('')).toEqual([]);
  });

  it('drops a truncated trailing record rather than inventing a path', () =>
  {
    const text =
      raw(':100644 100644 aaaaaaa bbbbbbb M', 'a.txt') +
      raw(':100644 100644 ccccccc ddddddd R100', 'only-one-path');
    expect(parseDiffRaw(text)).toEqual([
      { path: 'a.txt', status: 'modified', score: 0, kind: 'blob', mode: '100644', binary: false }
    ]);
  });
});
