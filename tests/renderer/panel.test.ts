/**
 * The left panel's model: section arrangement, the folder tree, sorting, flattening
 * and filtering.
 *
 * All pure, which is the point: the awkward cases (a branch and a folder of the same
 * name, a remote whose own name contains a slash, a stored section list from an older
 * build) are assertions here rather than repositories someone has to construct by hand.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPANDED,
  DEFAULT_SECTIONS,
  activationCommand,
  buildTree,
  isCurrentBranch,
  markMerged,
  pathTo,
  sectionNodeId,
  filterTree,
  flatten,
  moveSection,
  normalizeSections,
  walk,
  type PanelNode,
  type RepoObjects,
  type TreeOptions
} from '@renderer/panel.js';
import type { RefEntry, StashEntry, WorktreeEntry } from '@shared/types.js';

const ref = (over: Partial<RefEntry> & Pick<RefEntry, 'fullName' | 'name' | 'kind'>): RefEntry => ({
  sha: 'a'.repeat(40),
  date: 1000,
  isCurrent: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  remote: null,
  isAnnotated: false,
  ...over
});

const branch = (name: string, over: Partial<RefEntry> = {}): RefEntry =>
  ref({ fullName: `refs/heads/${name}`, name, kind: 'branch', ...over });

const remoteBranch = (name: string, remote = 'origin'): RefEntry =>
  ref({ fullName: `refs/remotes/${name}`, name, kind: 'remote', remote });

const tag = (name: string, over: Partial<RefEntry> = {}): RefEntry =>
  ref({ fullName: `refs/tags/${name}`, name, kind: 'tag', ...over });

const objects = (over: Partial<RepoObjects> = {}): RepoObjects => ({
  refs: [],
  remotes: [],
  stashes: [],
  submodules: [],
  worktrees: [],
  repoPath: '/repo',
  ...over
});

const options = (over: Partial<TreeOptions> = {}): TreeOptions => ({
  sections: [...DEFAULT_SECTIONS],
  sort: 'name',
  ascending: true,
  ...over
});

/** The children of one section, by label: the shape most assertions care about. */
function section(tree: PanelNode[], id: string): PanelNode
{
  const found = tree.find((node) => node.id === `section:${id}`);
  if (!found)
  {
    throw new Error(`no section ${id}`);
  }
  return found;
}

const labels = (nodes: PanelNode[]): string[] => nodes.map((n) => n.label);

describe('normalizeSections', () =>
{
  it('produces every section when nothing is stored', () =>
  {
    expect(normalizeSections(null)).toEqual([...DEFAULT_SECTIONS]);
  });

  it('keeps a stored order', () =>
  {
    expect(normalizeSections(['tags', 'branches']).slice(0, 2)).toEqual(['tags', 'branches']);
  });

  it('appends sections this build has that the stored list does not', () =>
  {
    const result = normalizeSections(['stashes']);
    expect(result[0]).toBe('stashes');
    expect(new Set(result)).toEqual(new Set(DEFAULT_SECTIONS));
  });

  it('drops a section this build no longer has', () =>
  {
    expect(normalizeSections(['buildStatus'])).toEqual([...DEFAULT_SECTIONS]);
  });

  it('ignores a duplicate id rather than listing a section twice', () =>
  {
    expect(normalizeSections(['tags', 'tags']).filter((id) => id === 'tags')).toHaveLength(1);
  });

  it('falls back whole when the stored value is not a list', () =>
  {
    expect(normalizeSections('branches')).toEqual([...DEFAULT_SECTIONS]);
  });

  // The shape written by the builds that had per-section visibility. Read for its
  // order; the flag goes, so a section someone had hidden comes back rather than
  // staying gone with nothing left in the UI to bring it back.
  it('reads the old `{ id, visible }` shape for its order and restores what was hidden', () =>
  {
    const stored = [
      { id: 'tags', visible: false },
      { id: 'branches', visible: false },
      { id: 'remotes', visible: true }
    ];
    expect(normalizeSections(stored).slice(0, 3)).toEqual(['tags', 'branches', 'remotes']);
    expect(new Set(normalizeSections(stored))).toEqual(new Set(DEFAULT_SECTIONS));
  });
});

describe('moveSection', () =>
{
  const sections = ['branches', 'remotes', 'tags'] as const;

  it('swaps with the neighbour above', () =>
  {
    expect(moveSection(sections, 'remotes', -1)).toEqual(['remotes', 'branches', 'tags']);
  });

  it('swaps with the neighbour below', () =>
  {
    expect(moveSection(sections, 'remotes', 1)).toEqual(['branches', 'tags', 'remotes']);
  });

  it('leaves the ends alone', () =>
  {
    expect(moveSection(sections, 'branches', -1)).toEqual([...sections]);
    expect(moveSection(sections, 'tags', 1)).toEqual([...sections]);
  });

  it('leaves a list it cannot find the section in unchanged', () =>
  {
    expect(moveSection(sections, 'stashes', -1)).toEqual([...sections]);
  });
});

describe('buildTree', () =>
{
  it('draws the sections in their configured order', () =>
  {
    const tree = buildTree(objects(), options({ sections: ['tags', 'branches', 'stashes'] }));
    expect(tree.map((n) => n.id)).toEqual(['section:tags', 'section:branches', 'section:stashes']);
  });

  // There is no hiding: an empty section is how you find out the repository has no
  // worktrees, and a section that could vanish is a section that can be lost.
  it('draws every section even when the repository has nothing in it', () =>
  {
    const tree = buildTree(objects(), options());
    expect(tree.map((n) => n.id)).toEqual(DEFAULT_SECTIONS.map((id) => `section:${id}`));
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('folds a slashed branch name into folders', () =>
  {
    const tree = buildTree(
      objects({ refs: [branch('feature/x'), branch('feature/y'), branch('main')] }),
      options()
    );
    const branches = section(tree, 'branches');
    expect(labels(branches.children)).toEqual(['feature', 'main']);
    expect(labels(branches.children[0]?.children ?? [])).toEqual(['x', 'y']);
  });

  it('keeps the full ref on a folded leaf, so a command still names it', () =>
  {
    const tree = buildTree(objects({ refs: [branch('feature/x')] }), options());
    const leaf = section(tree, 'branches').children[0]?.children[0];
    expect(leaf).toMatchObject({ label: 'x', ref: 'feature/x', fullName: 'refs/heads/feature/x' });
  });

  it('nests folders as deep as the name does', () =>
  {
    const tree = buildTree(objects({ refs: [branch('a/b/c/d')] }), options());
    const a = section(tree, 'branches').children[0];
    expect(a?.label).toBe('a');
    expect(a?.children[0]?.children[0]?.children[0]).toMatchObject({ label: 'd', ref: 'a/b/c/d' });
  });

  it('puts folders above leaves', () =>
  {
    const tree = buildTree(objects({ refs: [branch('zed'), branch('alpha/one')] }), options());
    expect(labels(section(tree, 'branches').children)).toEqual(['alpha', 'zed']);
  });

  it('marks the checked-out branch and annotates divergence', () =>
  {
    const tree = buildTree(
      objects({ refs: [branch('main', { isCurrent: true, ahead: 2, behind: 1 })] }),
      options()
    );
    expect(section(tree, 'branches').children[0]).toMatchObject({
      isCurrent: true,
      detail: '↑2 ↓1'
    });
  });

  it('says nothing about a branch level with its upstream', () =>
  {
    const tree = buildTree(objects({ refs: [branch('main', { upstream: 'origin/main' })] }), options());
    expect(section(tree, 'branches').children[0]?.detail).toBeUndefined();
  });

  it('flags a branch whose upstream is gone', () =>
  {
    const tree = buildTree(objects({ refs: [branch('old', { upstreamGone: true })] }), options());
    expect(section(tree, 'branches').children[0]).toMatchObject({ detail: 'gone', isStale: true });
  });

  it('nests remote branches under their remote, without repeating its name', () =>
  {
    const tree = buildTree(
      objects({
        remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }],
        refs: [remoteBranch('origin/main'), remoteBranch('origin/feature/x')]
      }),
      options()
    );
    const origin = section(tree, 'remotes').children[0];
    expect(origin).toMatchObject({ label: 'origin', kind: 'remote' });
    expect(labels(origin?.children ?? [])).toEqual(['feature', 'main']);
    // The operand keeps the remote, even though the label drops it.
    expect(origin?.children[1]).toMatchObject({ ref: 'origin/main' });
  });

  it('lists a remote with no branches as an empty node rather than omitting it', () =>
  {
    const tree = buildTree(
      objects({ remotes: [{ name: 'upstream', fetchUrl: 'u', pushUrl: 'u', disabled: false }] }),
      options()
    );
    expect(section(tree, 'remotes').children).toHaveLength(1);
    expect(section(tree, 'remotes').children[0]?.children).toEqual([]);
  });

  /**
   * Deactivated remotes, in their own folder at the bottom.
   *
   * The reason it matters that they appear at all: a remote is deactivated by renaming its
   * config section to `-remote.<name>`, which git then cannot see. If the panel dropped it
   * too, there would be no row left to right-click and no way back.
   */
  it('groups deactivated remotes under Inactive, after the active ones', () =>
  {
    const tree = buildTree(
      objects({
        remotes: [
          { name: 'fork', fetchUrl: 'f', pushUrl: 'f', disabled: true },
          { name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }
        ],
        refs: [remoteBranch('origin/main')]
      }),
      options()
    );
    const remotes = section(tree, 'remotes').children;
    expect(labels(remotes)).toEqual(['origin', 'Inactive']);
    expect(remotes[1]).toMatchObject({ kind: 'folder', detail: '1 deactivated' });
    expect(remotes[1]?.children[0]).toMatchObject({
      label: 'fork',
      kind: 'remote',
      isDisabled: true
    });
  });

  it('leaves the Inactive folder out entirely when every remote is active', () =>
  {
    const tree = buildTree(
      objects({ remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }] }),
      options()
    );
    expect(labels(section(tree, 'remotes').children)).toEqual(['origin']);
  });

  // git has no tracking refs for a remote it cannot see, so a deactivated remote's
  // branches are not stale data to be shown greyed: there are none.
  it('gives a deactivated remote no branches, even if tracking refs linger', () =>
  {
    const tree = buildTree(
      objects({
        remotes: [{ name: 'fork', fetchUrl: 'f', pushUrl: 'f', disabled: true }],
        refs: [remoteBranch('fork/main')]
      }),
      options()
    );
    const inactive = section(tree, 'remotes').children[0];
    expect(inactive?.children[0]?.children).toEqual([]);
  });

  it('folds tags by path too', () =>
  {
    const tree = buildTree(objects({ refs: [tag('release/1.0'), tag('v2')] }), options());
    expect(labels(section(tree, 'tags').children)).toEqual(['release', 'v2']);
  });

  it('keeps stashes in stack order whatever the sort says', () =>
  {
    const stashes: StashEntry[] = [
      { index: 0, name: 'stash@{0}', sha: 'a', date: 10, message: 'newer', branch: 'main' },
      { index: 1, name: 'stash@{1}', sha: 'b', date: 20, message: 'older', branch: 'main' }
    ];
    const tree = buildTree(objects({ stashes }), options({ sort: 'date', ascending: true }));
    expect(labels(section(tree, 'stashes').children)).toEqual(['newer', 'older']);
    // The selector is the operand and is positional, so it travels on the node even
    // though only the index is shown.
    expect(section(tree, 'stashes').children[1]).toMatchObject({
      ref: 'stash@{1}',
      detail: '@{1}'
    });
  });

  it('marks the worktree this window has open', () =>
  {
    const worktrees: WorktreeEntry[] = [
      {
        path: '/repo',
        head: 'a',
        branch: 'main',
        isBare: false,
        isDetached: false,
        isLocked: false,
        lockReason: '',
        prunable: false,
        isMain: true
      },
      {
        path: '/elsewhere/wt',
        head: 'b',
        branch: 'feature',
        isBare: false,
        isDetached: false,
        isLocked: false,
        lockReason: '',
        prunable: true,
        isMain: false
      }
    ];
    const children = section(buildTree(objects({ worktrees }), options()), 'worktrees').children;
    expect(children).toEqual([
      expect.objectContaining({ label: 'repo', isCurrent: true, detail: 'main' }),
      expect.objectContaining({ label: 'wt', isCurrent: false, isStale: true })
    ]);
  });

  it('reports an unpopulated submodule', () =>
  {
    const tree = buildTree(
      objects({
        submodules: [
          { name: 'lib', path: 'deps/lib', url: 'u', branch: null, initialized: false }
        ]
      }),
      options()
    );
    expect(section(tree, 'submodules').children[0]?.children[0]).toMatchObject({
      label: 'lib',
      detail: 'not initialized',
      isStale: true
    });
  });

  it('gives every node a unique id, which is what selection is keyed by', () =>
  {
    const tree = buildTree(
      objects({
        remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }],
        refs: [branch('feature/x'), tag('feature/x'), remoteBranch('origin/feature/x')]
      }),
      options()
    );
    const ids = [...walk(tree)].map((n) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('sorting', () =>
{
  const refs = [
    branch('alpha', { date: 300 }),
    branch('beta', { date: 100 }),
    branch('gamma', { date: 200 })
  ];

  it('sorts by name ascending', () =>
  {
    const tree = buildTree(objects({ refs }), options());
    expect(labels(section(tree, 'branches').children)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('sorts by name descending', () =>
  {
    const tree = buildTree(objects({ refs }), options({ ascending: false }));
    expect(labels(section(tree, 'branches').children)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('sorts by commit date, newest first when descending', () =>
  {
    const tree = buildTree(objects({ refs }), options({ sort: 'date', ascending: false }));
    expect(labels(section(tree, 'branches').children)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('breaks a date tie by name, so the order does not shuffle between reloads', () =>
  {
    const tied = [branch('b', { date: 5 }), branch('a', { date: 5 })];
    const tree = buildTree(objects({ refs: tied }), options({ sort: 'date', ascending: false }));
    expect(labels(section(tree, 'branches').children)).toEqual(['a', 'b']);
  });

  it('keeps folders in name order even when sorting by date', () =>
  {
    const nested = [branch('zeta/one', { date: 900 }), branch('alpha/one', { date: 1 })];
    const tree = buildTree(objects({ refs: nested }), options({ sort: 'date', ascending: false }));
    expect(labels(section(tree, 'branches').children)).toEqual(['alpha', 'zeta']);
  });
});

describe('flatten', () =>
{
  const tree = buildTree(objects({ refs: [branch('feature/x'), branch('main')] }), options());

  it('draws only what is expanded', () =>
  {
    const closed = flatten(tree, () => false);
    expect(closed.map((r) => r.node.label)).toEqual([
      'Branches',
      'Remotes',
      'Worktrees',
      'Tags',
      'Submodules',
      'Stashes'
    ]);
  });

  it('reports depth, so the rows can indent', () =>
  {
    const open = flatten(tree, () => true);
    const x = open.find((r) => r.node.label === 'x');
    expect(x?.depth).toBe(2);
  });

  it('marks which rows have a twisty', () =>
  {
    const open = flatten(tree, () => true);
    expect(open.find((r) => r.node.label === 'feature')?.expandable).toBe(true);
    expect(open.find((r) => r.node.label === 'main')?.expandable).toBe(false);
  });

  it('stops at a collapsed node', () =>
  {
    const rows = flatten(tree, (node) => node.id !== 'folder:branches:feature');
    expect(rows.map((r) => r.node.label)).toContain('feature');
    expect(rows.map((r) => r.node.label)).not.toContain('x');
  });
});

describe('filterTree', () =>
{
  const tree = buildTree(
    objects({
      remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }],
      refs: [branch('feature/needle'), branch('main'), remoteBranch('origin/needle')]
    }),
    options()
  );

  it('returns the tree untouched for an empty query', () =>
  {
    expect(filterTree(tree, '  ')).toEqual(tree);
  });

  it('keeps the folders a match sits in', () =>
  {
    const filtered = filterTree(tree, 'needle');
    const branches = section(filtered, 'branches');
    expect(labels(branches.children)).toEqual(['feature']);
    expect(labels(branches.children[0]?.children ?? [])).toEqual(['needle']);
  });

  it('drops what does not match', () =>
  {
    const branches = section(filterTree(tree, 'needle'), 'branches');
    expect(labels(branches.children)).not.toContain('main');
  });

  it('matches on the full ref, not only the label', () =>
  {
    const branches = section(filterTree(tree, 'feature/nee'), 'branches');
    expect(branches.children[0]?.children[0]?.label).toBe('needle');
  });

  it('keeps every section, so the panel does not jump while typing', () =>
  {
    expect(filterTree(tree, 'zzz').map((n) => n.id)).toEqual(tree.map((n) => n.id));
    expect(section(filterTree(tree, 'zzz'), 'branches').children).toEqual([]);
  });

  it('is case-insensitive', () =>
  {
    expect(section(filterTree(tree, 'NEEDLE'), 'branches').children).toHaveLength(1);
  });
});

describe('activationCommand', () =>
{
  it('checks out a branch, local or remote', () =>
  {
    expect(activationCommand('branch')).toBe('ref.checkout');
    expect(activationCommand('remoteBranch')).toBe('ref.checkout');
  });

  it('creates a branch from a tag rather than checking it out', () =>
  {
    // Checking out a tag detaches HEAD, so the action reachable by accident is the one
    // that does not.
    expect(activationCommand('tag')).toBe('ref.createBranch');
  });

  it('opens a stash, a submodule and a worktree', () =>
  {
    expect(activationCommand('stash')).toBe('stash.open');
    expect(activationCommand('submodule')).toBe('submodule.open');
    expect(activationCommand('worktree')).toBe('worktree.open');
  });

  it('has nothing for the rows that expand instead', () =>
  {
    expect(activationCommand('section')).toBeNull();
    expect(activationCommand('folder')).toBeNull();
  });
});

describe('hover text', () =>
{
  it('spells out a branch\u2019s divergence, which the row only has room to abbreviate', () =>
  {
    const tree = buildTree(
      objects({ refs: [branch('main', { upstream: 'origin/main', ahead: 2, behind: 1 })] }),
      options()
    );
    expect(section(tree, 'branches').children[0]).toMatchObject({
      detail: '\u21912 \u21931',
      title: 'main: 2 ahead, 1 behind origin/main'
    });
  });

  it('says a branch is level with its upstream, which the row says by staying silent', () =>
  {
    const tree = buildTree(
      objects({ refs: [branch('main', { upstream: 'origin/main' })] }),
      options()
    );
    expect(section(tree, 'branches').children[0]?.title).toBe('main: level with origin/main');
  });

  it('gives a folded branch its full name, not the last segment', () =>
  {
    const tree = buildTree(objects({ refs: [branch('feature/x')] }), options());
    expect(section(tree, 'branches').children[0]?.children[0]).toMatchObject({
      label: 'x',
      title: 'feature/x'
    });
  });

  it('shows both remote URLs only when they differ', () =>
  {
    const same = buildTree(
      objects({ remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }] }),
      options()
    );
    const differing = buildTree(
      objects({ remotes: [{ name: 'origin', fetchUrl: 'fetch-url', pushUrl: 'push-url', disabled: false }] }),
      options()
    );
    expect(section(same, 'remotes').children[0]?.title).toBe('u');
    expect(section(differing, 'remotes').children[0]?.title).toBe(
      'fetch: fetch-url\npush: push-url'
    );
  });

  it('marks an annotated tag', () =>
  {
    const tree = buildTree(
      objects({ refs: [tag('v1', { isAnnotated: true }), tag('v0')] }),
      options()
    );
    const titles = section(tree, 'tags').children.map((n) => n.title);
    expect(titles).toEqual(['v0', 'v1 (annotated)']);
  });
});

describe('pathTo', () =>
{
  const tree = buildTree(
    objects({
      refs: [branch('feature/nested/deep', { isCurrent: true }), branch('main'), tag('v1')]
    }),
    options()
  );

  it('returns the chain down to the checked-out branch, however deeply folded', () =>
  {
    const chain = pathTo(tree, isCurrentBranch);
    expect(chain?.map((n) => n.label)).toEqual(['Branches', 'feature', 'nested', 'deep']);
  });

  it('gives the ids to expand and the one to select', () =>
  {
    // What the store does with it: everything but the last is opened, the last selected.
    const chain = pathTo(tree, isCurrentBranch)!;
    expect(chain.slice(0, -1).map((n) => n.id)).toEqual([
      'section:branches',
      'folder:branches:feature',
      'folder:branches:feature/nested'
    ]);
    expect(chain[chain.length - 1]?.id).toBe('branch:refs/heads/feature/nested/deep');
  });

  it('finds a branch that is not folded at all', () =>
  {
    const flat = buildTree(objects({ refs: [branch('main', { isCurrent: true })] }), options());
    expect(pathTo(flat, isCurrentBranch)?.map((n) => n.label)).toEqual(['Branches', 'main']);
  });

  it('returns null on a detached HEAD, where no branch is current', () =>
  {
    const detached = buildTree(objects({ refs: [branch('main'), tag('v1')] }), options());
    expect(pathTo(detached, isCurrentBranch)).toBeNull();
  });

  it('does not mistake a remote branch or a tag for the current branch', () =>
  {
    // `%(HEAD)` only ever marks a local branch, but the predicate says so itself rather
    // than trusting that.
    const other = buildTree(
      objects({
        remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }],
        refs: [remoteBranch('origin/main'), tag('v1')]
      }),
      options()
    );
    expect(pathTo(other, isCurrentBranch)).toBeNull();
  });
});

describe('DEFAULT_EXPANDED', () =>
{
  const tree = buildTree(
    objects({
      refs: [branch('main', { isCurrent: true })],
      remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }],
      worktrees: [
        {
          path: '/repo',
          head: 'a',
          branch: 'main',
          isBare: false,
          isDetached: false,
          isLocked: false,
          lockReason: '',
          prunable: false,
          isMain: true
        }
      ]
    }),
    options()
  );

  const open = new Set<string>(DEFAULT_EXPANDED.map(sectionNodeId));
  const drawn = flatten(tree, (node) => open.has(node.id)).map((r) => r.node.label);

  it('shows the branch you are on and the worktree you are in, without a click', () =>
  {
    // Both carry the "current" marker, and a marker inside a collapsed section marks
    // nothing at all.
    expect(drawn).toContain('main');
    expect(drawn).toContain('repo');
  });

  it('leaves the lists you go looking for closed', () =>
  {
    expect(DEFAULT_EXPANDED).not.toContain('tags');
    expect(DEFAULT_EXPANDED).not.toContain('submodules');
    expect(DEFAULT_EXPANDED).not.toContain('stashes');
  });

  it('names only sections that exist', () =>
  {
    expect(DEFAULT_EXPANDED.filter((id) => !DEFAULT_SECTIONS.includes(id))).toEqual([]);
  });
});

describe('markMerged', () =>
{
  const main = branch('main', { sha: 'aaa' });
  const done = branch('done', { sha: 'bbb' });
  const remote = remoteBranch('origin/main');

  it('marks what git reported', () =>
  {
    const marked = markMerged(['refs/heads/done'], [main, done], 'aaa');
    expect([...marked]).toEqual(['refs/heads/done']);
  });

  it('drops the refs pointing at the commit itself', () =>
  {
    // git's --merged includes them, which is true and useless: a branch is not
    // "already contained in" the commit it is. Without this, clicking any branch marks
    // that branch as finished with.
    const marked = markMerged(['refs/heads/main', 'refs/heads/done'], [main, done], 'aaa');
    expect([...marked]).toEqual(['refs/heads/done']);
  });

  it('drops every ref at that commit, not just the first', () =>
  {
    const alias = branch('alias', { sha: 'aaa' });
    const marked = markMerged(
      ['refs/heads/main', 'refs/heads/alias', 'refs/heads/done'],
      [main, alias, done],
      'aaa'
    );
    expect([...marked]).toEqual(['refs/heads/done']);
  });

  it('marks everything when there is no selection to exclude', () =>
  {
    const marked = markMerged(['refs/heads/main'], [main], null);
    expect([...marked]).toEqual(['refs/heads/main']);
  });

  it('handles remote branches, which git reports by full name too', () =>
  {
    const marked = markMerged(['refs/remotes/origin/main'], [main, remote], 'aaa');
    expect([...marked]).toEqual(['refs/remotes/origin/main']);
  });
});

describe('merged branches in the tree', () =>
{
  const built = (mergedRefs: Set<string>) =>
    buildTree(
      objects({
        refs: [branch('main'), branch('done'), remoteBranch('origin/done')],
        remotes: [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u', disabled: false }],
        mergedRefs
      }),
      options()
    );

  it('flags a merged local branch and says so in its hover text', () =>
  {
    const tree = built(new Set(['refs/heads/done']));
    const [doneNode, mainNode] = section(tree, 'branches').children;
    expect(doneNode).toMatchObject({ label: 'done', isMerged: true });
    expect(doneNode?.title).toContain('contained in the selected commit');
    expect(mainNode).toMatchObject({ label: 'main', isMerged: false });
    expect(mainNode?.title).not.toContain('contained');
  });

  it('flags a merged remote branch too', () =>
  {
    const tree = built(new Set(['refs/remotes/origin/done']));
    expect(section(tree, 'remotes').children[0]?.children[0]).toMatchObject({
      label: 'done',
      isMerged: true
    });
  });

  it('marks nothing when the set is empty, which is the state before the read lands', () =>
  {
    const tree = built(new Set());
    expect(section(tree, 'branches').children.every((n) => n.isMerged === false)).toBe(true);
  });
});
