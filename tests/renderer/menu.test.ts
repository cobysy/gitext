/**
 * Resolving a declared menu against the command registry.
 *
 * The menu declaration carries ids and nothing else, so the interesting behaviour is
 * all here: what a declared-but-unbuilt command draws as, what happens to a rule with
 * nothing left on one side of it, and what a typo in a menu produces.
 *
 * Fixture commands rather than the real registry: the real command modules import the
 * stores, which import `renderer/api.ts`, which reads `window.git` at import time and
 * so cannot be loaded under Node. That constraint is the reason the resolver takes
 * ids and the registry takes labels.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  allCommands,
  declareCommand,
  defineCommand,
  getCommand,
  type CommandContext
} from '@renderer/commands/registry.js';
import { registerFileCommands } from '@renderer/commands/file.js';
import { registerObjectCommands } from '@renderer/commands/objects.js';
import { registerRevisionCommands } from '@renderer/commands/revision.js';
import { menuFor, panelBackgroundMenu } from '@renderer/menus/leftPanel.js';
import type { PanelNodeKind } from '@renderer/panel.js';
import type { FileStatusCode } from '@shared/types.js';
import {
  item,
  resolveMenu,
  separator,
  submenu,
  type MenuNode,
  type ResolvedItem
} from '@renderer/menus/resolve.js';
import { fileListMenu, fileListViewMenu } from '@renderer/menus/fileList.js';
import { stagingListMenu } from '@renderer/menus/staging.js';
import { revisionGridMenu } from '@renderer/menus/revisionGrid.js';
import { mainToolbar, type ToolbarNode } from '@renderer/menus/toolbar.js';
import { maintenanceMenu } from '@renderer/menus/maintenance.js';
import { currentBranchMenu } from '@renderer/menus/currentBranch.js';
import { workingDirectoryMenu } from '@renderer/menus/revisionGrid.js';

/**
 * The toolbar flattened to the ids it offers: a button's own id, and everything inside
 * a dropdown. It counts as a home: a command on the toolbar is one click away, which is
 * more reachable than a context menu, not less.
 */
/** Every command id in a declared menu, submenus included. */
const walkMenu = (nodes: readonly MenuNode[]): string[] =>
  nodes.flatMap((node) =>
  {
    if (node.kind === 'command')
    {
      return [node.id];
    }
    if (node.kind === 'submenu')
    {
      return walkMenu(node.items);
    }
    return [];
  });

/** Every menu the left panel can open: one per node kind, one per section, plus the background. */
const menusOfEveryKind = (): MenuNode[][] =>
{
  const kinds: PanelNodeKind[] = [
    'folder',
    'branch',
    'remote',
    'remoteBranch',
    'tag',
    'stash',
    'submodule',
    'worktree'
  ];
  const sections = [
    'section:branches',
    'section:remotes',
    'section:worktrees',
    'section:tags',
    'section:submodules',
    'section:stashes'
  ];
  return [
    ...kinds.map((kind) => menuFor(kind, '')),
    ...sections.map((id) => menuFor('section', id)),
    panelBackgroundMenu
  ];
};

const toolbarIds = (nodes: readonly ToolbarNode[]): string[] =>
  nodes.flatMap((node) =>
  {
    if (node.kind === 'button')
    {
      return [node.id];
    }
    if (node.kind === 'dropdown')
    {
      return node.items.flatMap((entry) =>
      {
        if (entry.kind === 'command')
        {
          return [entry.id];
        }
        else
        {
          return [];
        }
      });
    }
    return [];
  });

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  hasRepo: true,
  hasSuperproject: false,
  isMidOperation: false,
  hasChanges: false,
  selectionCount: 1,
  hasArtificialSelection: false,
  fileSelectionCount: 1,
  focusedPane: 'fileList',
  fileSource: 'workingTree',
  stagingSide: null,
  stagingSelectionCount: 0,
  selectedNode: null,
  selectedFile: null,
  ...over
});

/** A selected panel node, with the flags a predicate reads defaulting to off. */
const node = (
  over: Partial<NonNullable<CommandContext['selectedNode']>> & { kind: PanelNodeKind }
): NonNullable<CommandContext['selectedNode']> => ({
  isCurrent: false,
  isDisabled: false,
  ...over
});

// Registered once: `defineCommand` throws on a duplicate id, which is exactly the
// protection being relied on in `commands/index.ts`.
defineCommand({ id: 'test.built', label: 'Built', group: 'Test', run: () => undefined });
defineCommand({
  id: 'test.oneCommit',
  label: 'One Commit',
  group: 'Test',
  keys: ['Mod+K'],
  when: (c) => c.selectionCount === 1,
  run: () => undefined
});
defineCommand({
  id: 'test.noArtificial',
  label: 'Not Artificial',
  group: 'Test',
  when: (c) => !c.hasArtificialSelection,
  run: () => undefined
});
declareCommand('test.unbuilt', 'Unbuilt', 'Test');
declareCommand('test.unbuiltUnavailable', 'Unbuilt and Unavailable', 'Test', () => false);

// A toggle whose state the test drives, standing in for a panel section's visibility.
let toggleState = true;
defineCommand({
  id: 'test.toggle',
  label: 'Toggle',
  group: 'Test',
  checked: () => toggleState,
  run: () => undefined
});

function labels(items: ResolvedItem[]): string[]
{
  return items.map((i) =>
  {
    if (i.kind === 'separator')
    {
      return '---';
    }
    else
    {
      return i.label;
    }
  });
}

describe('resolveMenu', () =>
{
  it('takes the label and accelerator from the registry, not the menu', () =>
  {
    const [entry] = resolveMenu([item('test.oneCommit')], ctx());
    expect(entry).toEqual({
      kind: 'command',
      id: 'test.oneCommit',
      label: 'One Commit',
      accelerator: 'Mod+K',
      enabled: true
    });
  });

  it('omits the accelerator for a command that has no binding', () =>
  {
    const [entry] = resolveMenu([item('test.built')], ctx());
    expect(entry).not.toHaveProperty('accelerator');
  });

  it('greys a command whose `when` fails right now', () =>
  {
    const [entry] = resolveMenu([item('test.oneCommit')], ctx({ selectionCount: 2 }));
    expect(entry).toMatchObject({ label: 'One Commit', enabled: false });
  });

  it('greys a command that is declared but not built', () =>
  {
    const [entry] = resolveMenu([item('test.unbuilt')], ctx());
    expect(entry).toMatchObject({ id: 'test.unbuilt', label: 'Unbuilt', enabled: false });
  });

  it('greys artificial-row commands when the working tree or index is selected', () =>
  {
    const [entry] = resolveMenu(
      [item('test.noArtificial')],
      ctx({ hasArtificialSelection: true })
    );
    expect(entry).toMatchObject({ enabled: false });
  });

  // What a hidden panel section depends on: the row that brings it back has to say
  // that it is currently off, since the section itself has left nothing on screen.
  it('carries a toggle’s state through, on and off', () =>
  {
    toggleState = true;
    expect(resolveMenu([item('test.toggle')], ctx())[0]).toMatchObject({ checked: true });
    toggleState = false;
    expect(resolveMenu([item('test.toggle')], ctx())[0]).toMatchObject({ checked: false });
    toggleState = true;
  });

  it('leaves `checked` off a command that is an action rather than a state', () =>
  {
    const [entry] = resolveMenu([item('test.built')], ctx());
    expect(entry).not.toHaveProperty('checked');
  });

  it('drops an unknown id and says so, rather than drawing a mystery row', () =>
  {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveMenu([item('test.built'), item('test.doesNotExist')], ctx())).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('test.doesNotExist'));
    warn.mockRestore();
  });
});

describe('submenus', () =>
{
  it('is enabled when anything inside it can be clicked', () =>
  {
    const [entry] = resolveMenu(
      [submenu('Group', [item('test.unbuilt'), item('test.built')])],
      ctx()
    );
    expect(entry).toMatchObject({ kind: 'submenu', label: 'Group', enabled: true });
  });

  it('greys when everything inside it is greyed', () =>
  {
    const [entry] = resolveMenu(
      [submenu('Group', [item('test.unbuilt'), item('test.unbuiltUnavailable')])],
      ctx()
    );
    expect(entry).toMatchObject({ enabled: false });
    // Still drawn, and still populated: the point of greying rather than hiding is
    // that the shape does not change as phases land.
    expect((entry as { items: ResolvedItem[] }).items).toHaveLength(2);
  });

  it('disappears when nothing in it resolved at all', () =>
  {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveMenu([submenu('Gone', [item('test.nope')]), item('test.built')], ctx())).toEqual([
      expect.objectContaining({ id: 'test.built' })
    ]);
    warn.mockRestore();
  });

  it('resolves nested submenus', () =>
  {
    const [outer] = resolveMenu(
      [submenu('Outer', [submenu('Inner', [item('test.built')])])],
      ctx()
    );
    const inner = (outer as { items: ResolvedItem[] }).items[0]!;
    expect(inner).toMatchObject({ kind: 'submenu', label: 'Inner', enabled: true });
  });
});

describe('separators', () =>
{
  it('keeps one between two groups', () =>
  {
    const items = resolveMenu([item('test.built'), separator, item('test.unbuilt')], ctx());
    expect(labels(items)).toEqual(['Built', '---', 'Unbuilt']);
  });

  it('drops a leading and a trailing rule', () =>
  {
    const items = resolveMenu([separator, item('test.built'), separator], ctx());
    expect(labels(items)).toEqual(['Built']);
  });

  it('collapses a run of them', () =>
  {
    const items = resolveMenu(
      [item('test.built'), separator, separator, item('test.unbuilt')],
      ctx()
    );
    expect(labels(items)).toEqual(['Built', '---', 'Unbuilt']);
  });

  // The case that makes this worth having: a group vanishes because every id in it
  // was unknown, leaving its rules stranded against each other.
  it('collapses the rules around a group that resolved to nothing', () =>
  {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const items = resolveMenu(
      [item('test.built'), separator, item('test.gone'), separator, item('test.unbuilt')],
      ctx()
    );
    expect(labels(items)).toEqual(['Built', '---', 'Unbuilt']);
    warn.mockRestore();
  });

  it('returns nothing at all for a menu of only rules', () =>
  {
    expect(resolveMenu([separator, separator], ctx())).toEqual([]);
  });
});

/**
 * The real revision-grid menu, as far as it can be checked under Node.
 *
 * `commands/revision.ts` is the one command module that imports nothing but the
 * registry: every command in it is declared, not built, so it needs no store. That
 * covers every id the menu now holds, and a typo in one of them is precisely the
 * failure this catches: at runtime it is a warning and a missing row, which is easy to
 * miss in a menu that is meant to have greyed rows in it.
 *
 * `declaredHere` still filters rather than checking all of them, because the modules
 * behind the other prefixes (`view.`, `navigate.`, `copy.`) reach for `window` through
 * the stores and cannot be loaded here: so an id from one of those, were it added
 * back to this menu, would be left to the resolver's runtime warning.
 */
describe('the revision-grid menu declaration', () =>
{
  registerRevisionCommands();

  const walk = (nodes: readonly MenuNode[]): string[] =>
    nodes.flatMap((node) =>
    {
      if (node.kind === 'command')
      {
        return [node.id];
      }
      if (node.kind === 'submenu')
      {
        return walk(node.items);
      }
      return [];
    });

  const declaredHere = /^(branch|reset|commit|tag|compare|bisect|stash)\./;
  const ids = walk(revisionGridMenu());

  it('names commands that exist', () =>
  {
    const missing = ids.filter((id) => declaredHere.test(id) && getCommand(id) === undefined);
    expect(missing).toEqual([]);
  });

  it('lists no command twice', () =>
  {
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('keeps to what is used on a commit day to day', () =>
  {
    // The trim is the point of this menu, so its size is asserted rather than left to
    // drift back. Raise this deliberately, if at all.
    const topLevel = revisionGridMenu().filter((node: MenuNode) => node.kind !== 'separator');
    expect(topLevel.length).toBeLessThanOrEqual(16);
  });

  it('nests one level deep, never two', () =>
  {
    const depthOf = (nodes: readonly MenuNode[]): number =>
      Math.max(
        0,
        ...nodes.map((node) =>
        {
          if (node.kind === 'submenu')
          {
            return 1 + depthOf(node.items);
          }
          else
          {
            return 0;
          }
        })
      );
    expect(depthOf(revisionGridMenu())).toBeLessThanOrEqual(1);
  });

  it('offers the actions a commit is usually right-clicked for', () =>
  {
    const inMenu = new Set(ids);
    const expected = [
      'commit.checkout',
      'branch.create',
      'tag.create',
      'branch.merge',
      'branch.rebase',
      'reset.currentBranch',
      'commit.cherryPick',
      'commit.revert',
      // Was `commit.amend`, which is cut along with the rest of the `Advanced ▸` submenu.
      // Reword is what now occupies the "change something about this commit" slot.
      'commit.reword',
      'compare.withCurrent',
      'compare.selected'
    ];
    expect(expected.filter((id) => !inMenu.has(id))).toEqual([]);
  });
});

/**
 * The left panel's menus, checked the same way: with one addition the grid's menu
 * could not have: `commands/objects.ts` declares its commands and imports no store, so
 * the set it registers can be captured exactly and every one of them held to appearing
 * somewhere. A command declared for a menu and then left out of it is invisible, which
 * is a worse failure than a typo because nothing warns about it.
 */
describe('the left-panel menu declarations', () =>
{
  const before = new Set(allCommands().map((c) => c.id));
  registerObjectCommands();
  const declaredByObjects = allCommands()
    .map((c) => c.id)
    .filter((id) => !before.has(id));

  const walk = (nodes: readonly MenuNode[]): string[] =>
    nodes.flatMap((node) =>
    {
      if (node.kind === 'command')
      {
        return [node.id];
      }
      if (node.kind === 'submenu')
      {
        return walk(node.items);
      }
      return [];
    });

  const kinds: PanelNodeKind[] = [
    'folder',
    'branch',
    'remote',
    'remoteBranch',
    'tag',
    'stash',
    'submodule',
    'worktree'
  ];
  const sectionIds = [
    'section:branches',
    'section:remotes',
    'section:worktrees',
    'section:tags',
    'section:submodules',
    'section:stashes'
  ];

  const menus = [
    ...kinds.map((kind) => ({ name: kind, items: menuFor(kind, '') })),
    ...sectionIds.map((id) => ({ name: id, items: menuFor('section', id) })),
    { name: 'background', items: panelBackgroundMenu }
  ];

  it('gives every node kind a menu with something in it', () =>
  {
    expect(menus.filter((m) => m.items.length === 0)).toEqual([]);
  });

  it('names commands that exist', () =>
  {
    // `panel.*` is built, so it lives in a module that imports the stores and cannot be
    // loaded under Node; the resolver warns about an unknown id at runtime.
    const declaredHere = /^(ref|remote|remoteBranch|tag|stash|submodule|worktree|branch)\./;
    const missing = menus.flatMap((menu) =>
      walk(menu.items).filter((id) => declaredHere.test(id) && getCommand(id) === undefined)
    );
    expect(missing).toEqual([]);
  });

  it('lists no command twice within one menu', () =>
  {
    const duplicated = menus.filter((menu) =>
    {
      const ids = walk(menu.items);
      return ids.length !== new Set(ids).size;
    });
    expect(duplicated.map((m) => m.name)).toEqual([]);
  });

  it('reaches every command `objects.ts` declares from some menu', () =>
  {
    // The toolbar counts: pull, push, fetch and the stash actions have no panel node as
    // their operand, they act on the repository or on the current branch, so a
    // context menu is the wrong home for them and the toolbar is the right one.
    const reachable = new Set([
      ...menus.flatMap((menu) => walk(menu.items)),
      ...toolbarIds(mainToolbar())
    ]);
    expect(declaredByObjects.filter((id) => !reachable.has(id))).toEqual([]);
  });

  /**
   * These read `when` rather than the resolved row, because every command in this menu
   * is declared and not yet built: so `resolveMenu` greys all of them for that reason
   * alone, and would keep passing whatever the predicate said. Once Phase 3 gives them
   * a `run`, the predicate is the only thing deciding, which is what is asserted here.
   */
  const applies = (id: string, context: CommandContext): boolean =>
    getCommand(id)?.when?.(context) ?? true;

  it('does not apply the ref actions until the panel has a ref selected', () =>
  {
    expect(applies('ref.checkout', ctx({ selectedNode: null }))).toBe(false);
    expect(
      applies('ref.checkout', ctx({ selectedNode: node({ kind: 'branch', isCurrent: false }) }))
    ).toBe(true);
  });

  it('withholds Delete on the checked-out branch, and offers it on any other', () =>
  {
    expect(applies('ref.delete', ctx({ selectedNode: node({ kind: 'branch', isCurrent: true }) }))).toBe(
      false
    );
    expect(applies('ref.delete', ctx({ selectedNode: node({ kind: 'branch', isCurrent: false }) }))).toBe(
      true
    );
  });

  it('applies the stash actions to a stash node with no commit selected', () =>
  {
    // The same commands serve the grid, where the operand is a selected row; a stash
    // node has to satisfy them on its own.
    const onNode = ctx({ selectionCount: 0, selectedNode: node({ kind: 'stash', isCurrent: false }) });
    expect(applies('stash.pop', onNode)).toBe(true);
    expect(applies('stash.pop', ctx({ selectionCount: 0, selectedNode: null }))).toBe(false);
  });

  it('does not apply a branch action to a remote node', () =>
  {
    const onRemote = ctx({ selectedNode: node({ kind: 'remote', isCurrent: false }) });
    expect(applies('ref.push', onRemote)).toBe(false);
    expect(applies('remote.fetch', onRemote)).toBe(true);
  });

  /**
   * A deactivated remote's config section is `-remote.<name>`, so git cannot see it:
   * fetching it, pruning it or deleting a branch on it are not operations that can be
   * attempted. The toggle shows only the half that is not already true.
   */
  it('offers a deactivated remote only the row that switches it back on', () =>
  {
    const off = ctx({ selectedNode: node({ kind: 'remote', isDisabled: true }) });
    const on = ctx({ selectedNode: node({ kind: 'remote' }) });

    expect(applies('remote.enable', off)).toBe(true);
    expect(applies('remote.enableAndFetch', off)).toBe(true);
    expect(applies('remote.disable', off)).toBe(false);
    expect(applies('remote.fetch', off)).toBe(false);
    expect(applies('remote.fetchPrune', off)).toBe(false);
    expect(applies('remote.deleteBranches', off)).toBe(false);

    expect(applies('remote.enable', on)).toBe(false);
    expect(applies('remote.disable', on)).toBe(true);

    // Its URL is still readable, and still copyable: that is the point of deactivating
    // rather than deleting.
    expect(applies('remote.openUrl', off)).toBe(true);
  });

  it('gives each section its own actions', () =>
  {
    expect(walk(menuFor('section', 'section:tags'))).toContain('tag.create');
    expect(walk(menuFor('section', 'section:stashes'))).toContain('stash.save');
    // An unknown section still produces a usable menu rather than an empty one.
    expect(menuFor('section', 'section:nope').length).toBeGreaterThan(0);
  });
});

/**
 * The changed-files menu, held to the same invariant as the left panel's.
 *
 * `commands/file.ts` declares and imports nothing but the registry, so: exactly as with
 * `objects.ts`: the set of ids it registers can be captured and every one of them held
 * to appearing somewhere. That now covers the built ones too: their `run` lives in
 * `workingFile.ts`, which imports the stores and cannot be loaded here, but the
 * declaration does not, so the resolver finds every id these menus name.
 */
describe('the changed-files menu', () =>
{
  const before = new Set(allCommands().map((c) => c.id));
  registerFileCommands();
  const declaredByFile = allCommands()
    .map((c) => c.id)
    .filter((id) => !before.has(id));

  const walk = (nodes: readonly MenuNode[]): string[] =>
    nodes.flatMap((node) =>
    {
      if (node.kind === 'command')
      {
        return [node.id];
      }
      if (node.kind === 'submenu')
      {
        return walk(node.items);
      }
      return [];
    });

  /**
   * Both surfaces a file command can live on.
   *
   * The commit screen's list menu counts as a home for the same reason the toolbar
   * does: a command on it is reachable by right-clicking the file it acts on. Several
   * rows belong there and nowhere else: marking a file skip-worktree is something you
   * do while deciding what to commit, not while reading a commit that already happened.
   */
  const inFileList = new Set(walk(fileListMenu));
  const inStagingList = new Set(walk(stagingListMenu));
  const inMenu = new Set([...inFileList, ...inStagingList]);

  /** Deliberately palette-only. Each line is a decision, not an oversight. */
  const elsewhere = new Map<string, string>([
    // The rows nobody reaches for while reading a diff, and the menu is long enough
    // without them.
    ['file.findInFiles', 'palette: its operand is the commit, not the selected file']
  ]);

  it('offers every declared file command somewhere, or records why not', () =>
  {
    expect(declaredByFile.filter((id) => !inMenu.has(id) && !elsewhere.has(id))).toEqual([]);
  });

  it('does not list a command as living elsewhere while it is still in the menu', () =>
  {
    expect([...elsewhere.keys()].filter((id) => inMenu.has(id))).toEqual([]);
  });

  it('agrees between the two menus about which rows leave rather than grey', () =>
  {
    // The price of putting `hideIfUnavailable` on the row rather than on the command:
    // two menus can now disagree about the same id, and a file command that vanished on
    // one surface and greyed on the other would be one surface's bug either way.
    const marks = (nodes: readonly MenuNode[]): Map<string, boolean> =>
    {
      const found = new Map<string, boolean>();
      const visit = (items: readonly MenuNode[]): void =>
      {
        for (const node of items)
        {
          if (node.kind === 'command')
          {
            found.set(node.id, node.hideIfUnavailable === true);
          }
          else if (node.kind === 'submenu')
          {
            visit(node.items);
          }
        }
      };
      visit(nodes);
      return found;
    };

    const here = marks(fileListMenu);
    const there = marks(stagingListMenu);
    const disagreed = [...here].filter(([id, hides]) => there.has(id) && there.get(id) !== hides);
    expect(disagreed).toEqual([]);
    // And the mechanism is in use, so the test above is not passing on an empty set.
    expect([...here.values()].filter(Boolean).length).toBeGreaterThan(0);
  });

  it('offers the same file on both surfaces the same way', () =>
  {
    // These were once held back to the commit screen, on the grounds that you mark a
    // file skip-worktree while staging rather than while reading a commit. Wrong twice:
    // the file pane's pivot is the working tree as often as it is two commits, the
    // artificial rows are where most people meet their unstaged changes. A row that greys
    // itself costs nothing; a missing one costs
    // a hunt.
    for (const id of [
      'file.skipWorktree',
      'file.assumeUnchanged',
      'file.stopTracking',
      'file.showInFileTree',
      'file.exclude'
    ])
    {
      expect(inFileList.has(id)).toBe(true);
      expect(inStagingList.has(id)).toBe(true);
    }
  });

  it('keeps the pivot-only comparisons off the commit screen', () =>
  {
    // Their operand is the two ends of a pivot the commit screen does not have, which
    // range its list is showing is decided by which of the two lists you are in.
    for (const id of ['file.diffFirstToWorking', 'file.diffSecondToWorking', 'file.diffSelected'])
    {
      expect(inFileList.has(id)).toBe(true);
      expect(inStagingList.has(id)).toBe(false);
    }
  });

  it('lists no command twice', () =>
  {
    const ids = walk(fileListMenu);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('keeps the list\'s own view menu apart from the file\'s', () =>
  {
    // Two menus because the operands differ: one acts on the file you clicked, the other
    // on the shape of the list. Sharing a row between them is how a file menu reaches
    // thirty rows.
    const view = walk(fileListViewMenu);
    expect(view.length).toBeGreaterThan(0);
    expect(view.filter((id) => inMenu.has(id))).toEqual([]);
    expect(view.every((id) => id.startsWith('files.'))).toBe(true);
  });

  it('withholds the working-file actions on a file that was deleted', () =>
  {
    // Read through `when`, not the resolved row: these are declared and not yet built,
    // so `resolveMenu` greys all of them for that reason alone and would keep passing
    // whatever the predicate said.
    const on = (status: FileStatusCode): CommandContext =>
      ctx({ selectedFile: { status, isSubmodule: false } });
    expect(getCommand('file.editWorkingFile')?.when?.(on('deleted'))).toBe(false);
    expect(getCommand('file.editWorkingFile')?.when?.(on('modified'))).toBe(true);
  });

  it('withholds the working-tree actions on a file read out of a commit', () =>
  {
    // A row from a commit two years old draws exactly like a row from `git status`, and
    // every one of these acts on what is on disk now: a different file from the one
    // clicked. Staging a revision's file is the clearest of them: it would stage whatever
    // the working tree happens to hold.
    const onCommit = ctx({ selectedFile: { status: 'modified', isSubmodule: false }, fileSource: 'commit' });
    for (const id of ['file.stage', 'file.unstage', 'file.reset', 'file.move', 'file.delete'])
    {
      expect([id, getCommand(id)?.when?.(onCommit)]).toEqual([id, false]);
    }
    // What a commit *can* answer: restoring the file as of either end of the pivot.
    expect(getCommand('file.resetToParent')?.when?.(onCommit)).toBe(true);
    expect(getCommand('file.cherryPickChanges')?.when?.(onCommit)).toBe(true);
  });

  it('leaves those rows out of the drawn menu rather than greying them', () =>
  {
    // Greyed says "not right now", which reads as though some other click would bring the
    // row back. Over a file read out of a commit nothing will, so the row goes.
    const drawn = (source: CommandContext['fileSource']): string[] =>
    {
      const collect = (items: ResolvedItem[]): string[] =>
        items.flatMap((entry) =>
        {
          if (entry.kind === 'command')
          {
            return [entry.id];
          }
          else if (entry.kind === 'submenu')
          {
            return collect(entry.items);
          }
          else
          {
            return [];
          }
        }
        );
      return collect(
        resolveMenu(fileListMenu, ctx({ selectedFile: { status: 'modified', isSubmodule: false }, fileSource: source }))
      );
    };

    const onCommit = drawn('commit');
    for (const id of ['file.stage', 'file.unstage', 'file.reset', 'file.move', 'file.delete'])
    {
      expect([id, onCommit.includes(id)]).toEqual([id, false]);
    }
    expect(onCommit).toContain('file.resetToParent');
    // Still greyed rather than gone: unbuilt is "not yet", and the menu is meant to show
    // its full shape from the start.
    expect(onCommit).toContain('file.blame');

    expect(drawn('workingTree')).toContain('file.stage');
    expect(drawn('index')).toContain('file.unstage');
  });

  it('offers staging and unstaging to the half of git each belongs to', () =>
  {
    const from = (source: CommandContext['fileSource']): CommandContext =>
      ctx({ selectedFile: { status: 'modified', isSubmodule: false }, fileSource: source });
    expect(getCommand('file.stage')?.when?.(from('workingTree'))).toBe(true);
    expect(getCommand('file.stage')?.when?.(from('index'))).toBe(false);
    expect(getCommand('file.unstage')?.when?.(from('index'))).toBe(true);
    expect(getCommand('file.unstage')?.when?.(from('workingTree'))).toBe(false);
  });

  it('applies nothing to a file list with no selection', () =>
  {
    const empty = ctx({ selectedFile: null });
    expect(getCommand('file.stage')?.when?.(empty)).toBe(false);
    expect(getCommand('file.history')?.when?.(empty)).toBe(false);
  });
});

describe('the revision grid checkout submenu', () =>
{
  const gridCtx = ctx({ hasRepo: true, selectionCount: 1 });

  it('lists the branches on the commit, and names each row after one', () =>
  {
    const items = resolveMenu(
      revisionGridMenu([
        { ref: 'main', remote: false },
        { ref: 'origin/main', remote: true }
      ]),
      gridCtx
    );
    const checkout = items.find((i) => i.kind === 'submenu' && i.label === 'Checkout Branch');

    expect(checkout).toBeDefined();
    if (checkout?.kind !== 'submenu')
    {
      throw new Error('not a submenu');
    }
    // Not `enabled`: nothing in this file implements a command, so every real row greys
    // here for a reason that has nothing to do with the submenu. What it *has* is rows.
    expect(checkout.items).toHaveLength(2);
    expect(
      checkout.items.map((i) =>
      {
        if (i.kind === 'command')
        {
          return i.label;
        }
        else
        {
          return ':';
        }
      })
    ).toEqual([
      'main',
      'origin/main'
    ]);
    // The operand travels with the row, which is the whole point: the command cannot
    // read it back off a selection, because clicking a menu row moves nothing.
    expect(
      checkout.items.map((i) =>
      {
        if (i.kind === 'command')
        {
          return i.options;
        }
        else
        {
          return null;
        }
      })
    ).toEqual([
      { ref: 'main', remote: false },
      { ref: 'origin/main', remote: true }
    ]);
  });

  /**
   * A commit with nothing to check out: the current branch's own tip, most often.
   *
   * Greyed and still there. A row that opened a branch picker with nothing selected
   * would read as the app having lost the operand rather than as "nothing to do here".
   */
  it('greys, rather than vanishing or offering a picker, when the commit has none', () =>
  {
    const items = resolveMenu(revisionGridMenu([]), gridCtx);
    const checkout = items.find((i) => i.kind === 'submenu' && i.label === 'Checkout Branch');

    if (checkout?.kind !== 'submenu')
    {
      throw new Error('the row is gone entirely');
    }
    expect(checkout.enabled).toBe(false);
    expect(checkout.items).toEqual([]);
    // And the picker is not sitting beside it: that row lives in the Branch menu, where
    // no commit has been pointed at.
    expect(items.some((i) => i.kind === 'command' && i.id === 'branch.checkout')).toBe(false);
  });
});

/**
 * The repo-wide housekeeping, and the one place it is offered from.
 *
 * Each of these acts on the whole repository, so no row in any list is its operand:
 * offered from a context menu, the row claims to act on whatever was right-clicked. They
 * were spread over four surfaces before they were gathered here, and the way that comes
 * back is somebody adding one to the list whose section it sounds like it belongs to.
 */
describe('the maintenance menu', () =>
{
  const ids = walkMenu(maintenanceMenu);

  it('carries the housekeeping whose operand is the repository', () =>
  {
    expect(ids).toEqual([
      'branch.cleanup',
      'remote.fetchAllPrune',
      'worktree.prune',
      'workdir.clean',
      'repo.gc',
      'repo.fsck',
      'repo.deleteIndexLock'
    ]);
  });

  it('is on the toolbar, which is what makes it reachable', () =>
  {
    expect(ids.filter((id) => !toolbarIds(mainToolbar()).includes(id))).toEqual([]);
  });

  it('holds the only copy in the panel and grid menus', () =>
  {
    // `workdir.clean` is the exception, and stays one: the working-directory row *is* the
    // working tree, so that menu's copy names its own operand.
    const elsewhere = [
      ...menusOfEveryKind().flatMap((menu) => walkMenu(menu)),
      ...walkMenu(currentBranchMenu()),
      ...walkMenu(revisionGridMenu())
    ];
    expect(ids.filter((id) => id !== 'workdir.clean' && elsewhere.includes(id))).toEqual([]);
  });

  it('leaves the working-directory row its own copy', () =>
  {
    expect(walkMenu(workingDirectoryMenu)).toContain('workdir.clean');
  });
});

/**
 * The native menu bar, against the command registry.
 *
 * Nothing else checks it, and that gap has now cost four dead rows twice over. A context
 * menu drops an unknown id and warns (see "drops an unknown id" above); the native menu
 * does not: `cmd()` in `main/menu.ts` builds an unconditionally-enabled row that sends
 * its id, and `useCommands.dispatch` toasts `"<id>" is not available yet` when nothing
 * handles it. So a row for an id no module registers looks entirely normal until somebody
 * clicks it.
 *
 * Read as **source text** rather than imported. `main/menu.ts` imports Electron, which is
 * not loadable here, and half the command modules import the stores, which read
 * `window.git` at import time: so neither side of the comparison can actually be run.
 * Both are regular enough to scan: a menu row is `cmd('Label', 'id')`, and a registration
 * is one of three known forms. A textual check that runs is worth more than a structural
 * one that cannot.
 */
describe('the native menu bar', () =>
{
  const source = (path: string): string =>
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  /** Every id `main/menu.ts` dispatches. */
  const menuIds = [...source('main/menu.ts').matchAll(/cmd\('[^']*',\s*'([^']+)'/g)].map(
    (match) => match[1] as string
  );

  /** Every id any command module registers, in any of the three forms. */
  const registeredIds = new Set(
    readdirSync(new URL('../../renderer/commands/', import.meta.url))
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) => [
        ...source(`renderer/commands/${file}`).matchAll(
          /(?:declareCommand\(|implementCommand\()'([^']+)'|id:\s*'([^']+)'/g
        )
      ])
      .map((match) => (match[1] ?? match[2]) as string)
  );

  /**
   * Ids that are deliberately on the menu with nothing behind them yet, each with the
   * phase that owns it.
   *
   * Empty, and the second test below is what keeps it that way: an entry may only be added
   * for work that is genuinely outstanding, and has to come off again the moment it is
   * built. It is a statement of what is left, not a suppression.
   */
  const notYetBuilt = new Map<string, string>([]);

  /**
   * `view.column.<id>` is registered in a loop over the column list rather than written
   * out, so the scan above cannot see it. The prefix is the exception, not each id.
   */
  const generated = /^view\.column\./;

  it('dispatches no id that nothing registers', () =>
  {
    const dead = menuIds.filter(
      (id) => !registeredIds.has(id) && !notYetBuilt.has(id) && !generated.test(id)
    );
    expect(dead).toEqual([]);
  });

  it('lists nothing as unbuilt that has since been built', () =>
  {
    // The other direction, so the allow-list cannot quietly outlive its reason. This is
    // what took the four Phase 5 ids off it.
    const stale = [...notYetBuilt.keys()].filter((id) => registeredIds.has(id));
    expect(stale).toEqual([]);
  });

  it('found the menu and the registrations at all', () =>
  {
    // A regex that silently matched nothing would make both tests above pass for ever.
    expect(menuIds.length).toBeGreaterThan(50);
    expect(registeredIds.size).toBeGreaterThan(100);
  });
});
