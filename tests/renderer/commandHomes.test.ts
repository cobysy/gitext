/**
 * Every declared command has a home, checked against the *whole* registry.
 *
 * Not "every command `revision.ts` declares is in the grid's menu": that menu is trimmed
 * to what is used day to day. The invariant underneath it is the one worth holding: a
 * command that no surface offers is an action that gets built and then cannot be invoked.
 *
 * So each command must be on some surface, or listed below as deliberately living in the
 * palette alone. Adding a command means choosing one of the two, and trimming a menu
 * means recording the decision here rather than letting a command quietly fall off the
 * edge of the app.
 *
 * Its own file, and not part of `menu.test.ts`, for the reason `accelerators.test.ts`
 * gives: the resolver tests run on fixture commands under plain Node, and this one needs
 * every module. The prefixes it covers used to be a regex naming twelve of them, which is
 * how six `copy.*` commands and a whole filtering window came to be reachable from the
 * palette and nowhere else without failing anything. It covers all of them now.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { INVOKE_CHANNELS } from '@shared/contract.js';
import type { CommandDef } from '@renderer/commands/registry.js';
import type { MenuNode } from '@renderer/menus/resolve.js';
import type { PanelNodeKind } from '@renderer/panel.js';

/**
 * Separates the two halves of a grouping key. A character no label contains, so a group
 * ending in a word cannot run into a label starting with one and read as a third pair.
 */
const KEY_SEPARATOR = '\u0000';

const source = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

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
 * Deliberately palette-only, or living somewhere no menu declaration can show. Each line
 * is a decision, not an oversight: an entry says where the command actually is and why
 * that is the right place, and the tests below stop one outliving its reason.
 */
const elsewhere = new Map<string, string>([
  // Preferences, not mid-session reaches: their home is Settings, which is a form rather
  // than a menu, so no declaration here can carry them.
  ['view.commitInfoLeft', 'Settings > Appearance'],
  ['view.commitInfoRight', 'Settings > Appearance'],
  ['view.branchesFiltered', 'Settings > Graph: the pattern it walks lives there too'],
  ['view.showReflog', 'Settings > Graph'],
  ['view.showStashes', 'Settings > Graph'],
  ['view.showRemoteBranches', 'Settings > Graph'],
  ['view.showTags', 'Settings > Graph'],
  ['view.toggleArtificialCommits', 'Settings > Graph'],
  ['view.grayNonRelativesOff', 'Settings > Graph'],
  ['view.grayNonRelatives', 'Settings > Graph'],
  ['view.grayNonRelativesText', 'Settings > Graph'],
  ['view.mergeCommonParentLanes', 'Settings > Graph'],
  // The rows nobody reaches for while reading a diff, and the menu is long enough
  // without them.
  ['file.findInFiles', 'palette: its operand is the commit, not the selected file'],
  // Acts on HEAD, not on the selected row, so the grid's menu is the wrong home for it.
  ['commit.openInNewWindow', 'palette'],
  // Controls of their own on the commit screen: a button, or a keystroke over a list that
  // already answers the arrow keys. A menu row would name a gesture that is already there.
  ['staging.commitAndPush', 'the commit screen: its own button beside Commit'],
  ['staging.selectNext', 'the commit screen: a keystroke over a list that scrolls'],
  ['staging.selectPrevious', 'the commit screen: a keystroke over a list that scrolls'],
  ['staging.focusUnstaged', 'the commit screen: a keystroke, and the panes are all visible'],
  ['staging.focusStaged', 'the commit screen: a keystroke, and the panes are all visible'],
  ['staging.focusDiff', 'the commit screen: a keystroke, and the panes are all visible'],
  ['staging.focusMessage', 'the commit screen: a keystroke, and the panes are all visible'],
  // Bound to F7 and Shift+F7 over the diff itself. A menu row for "go to the next one of
  // the thing you are looking at" names a gesture the pane already answers.
  ['diff.nextDifference', 'the diff pane: F7, over the diff it steps through'],
  ['diff.previousDifference', 'the diff pane: Shift+F7, over the diff it steps through']
]);

let allCommands: () => CommandDef[];
let inSomeMenu: Set<string>;
/** Every command by id, for the two checks that read the menu bar's source beside it. */
let registryLabels: Map<string, CommandDef>;

beforeAll(async () =>
{
  const git: Record<string, unknown> = { on: () => () => undefined };
  for (const channel of INVOKE_CHANNELS)
  {
    git[channel] = () => Promise.resolve(undefined);
  }
  (globalThis as unknown as { window: unknown }).window = { git };

  const registry = await import('@renderer/commands/registry.js');
  const { registerCommands } = await import('@renderer/commands/index.js');
  registerCommands();
  allCommands = registry.allCommands;

  const grid = await import('@renderer/menus/revisionGrid.js');
  const panel = await import('@renderer/menus/leftPanel.js');
  const files = await import('@renderer/menus/fileList.js');
  const staging = await import('@renderer/menus/staging.js');
  const { mainToolbar } = await import('@renderer/menus/toolbar.js');

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

  /**
   * The toolbar flattened to the ids it offers. It counts as a home: a command on the
   * toolbar is one click away, which is more reachable than a context menu, not less.
   */
  const toolbarIds = mainToolbar().flatMap((node) =>
  {
    if (node.kind === 'button')
    {
      return [node.id];
    }
    if (node.kind === 'dropdown')
    {
      return walk(node.items);
    }
    return [];
  });

  /**
   * The menu bar, read from its source. `main/menu.ts` is Electron code that cannot be
   * imported under Node, and its rows are a home like any other.
   */
  const menuBarIds = [...source('main/menu.ts').matchAll(/cmd\('[^']*',\s*'([^']+)'/g)].map(
    (match) => match[1] as string
  );

  inSomeMenu = new Set([
    // With a branch on the commit: the checkout submenu is built from the row's own refs,
    // so an empty one would report `revision.checkoutBranchHere` as having no home.
    ...walk(grid.revisionGridMenu([{ ref: 'main', remote: false }])),
    ...kinds.flatMap((kind) => walk(panel.menuFor(kind, ''))),
    ...sections.flatMap((id) => walk(panel.menuFor('section', id))),
    ...walk(panel.panelSortMenu),
    ...walk(panel.panelBackgroundMenu),
    ...walk(files.fileListMenu),
    ...walk(files.fileListViewMenu),
    ...walk(files.filesPaneModeMenu),
    ...walk(files.filePaneViewMenu),
    ...walk(files.diffOptionsMenu),
    ...walk(staging.stagingListMenu),
    ...walk(staging.stagingListViewMenu),
    ...walk(staging.commitOptionsMenu({ recentMessages: ['m'], recentAuthors: ['a <a@b>'] })),
    ...walk(staging.commitResetMenu),
    ...toolbarIds,
    ...menuBarIds
  ]);

  registryLabels = new Map(allCommands().map((command) => [command.id, command]));
});

describe('command homes', () =>
{
  it('reads every surface, not only the ones one test file imports', () =>
  {
    // A set built from a menu that failed to import would make the check below pass for
    // ever, and so would a registry with three modules in it.
    expect(allCommands().length).toBeGreaterThan(200);
    expect(inSomeMenu.size).toBeGreaterThan(150);
  });

  it('offers every declared command somewhere, or records why not', () =>
  {
    const homeless = allCommands()
      .map((command) => command.id)
      .filter((id) => !inSomeMenu.has(id) && !elsewhere.has(id));
    expect(homeless).toEqual([]);
  });

  it('does not list a command as living elsewhere while it is still in a menu', () =>
  {
    // The other direction, so the list above cannot rot into a lie.
    const stale = [...elsewhere.keys()].filter((id) => inSomeMenu.has(id));
    expect(stale).toEqual([]);
  });

  it('names nothing that is not a command', () =>
  {
    const ids = new Set(allCommands().map((command) => command.id));
    const unknown = [...elsewhere.keys()].filter((id) => !ids.has(id));
    expect(unknown).toEqual([]);
  });

  /**
   * No two commands may read the same in the command palette.
   *
   * A menu row can lean on its surroundings: the left panel's `ref.merge` needs no more
   * than "Merge into Current Branch…" because you right-clicked the branch. The palette
   * has no surroundings: it shows a group and a label, so two commands sharing both are
   * two identical rows and picking one is a coin toss.
   *
   * The trailing ellipsis is not part of the name; it means the row opens a window, and
   * two commands cannot be told apart by it.
   */
  it('gives every command a label no other command in its group shares', () =>
  {
    const seen = new Map<string, string[]>();
    for (const command of allCommands())
    {
      const key = `${command.group}${KEY_SEPARATOR}${command.label.replace(/…$/, '').trim()}`;
      seen.set(key, [...(seen.get(key) ?? []), command.id]);
    }

    const clashes = [...seen.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => `${key.split(KEY_SEPARATOR)[1]} (${ids.join(', ')})`);

    expect(clashes).toEqual([]);
  });
});

/**
 * The working-tree and index rows' own menu.
 *
 * Right-clicking either of them used to resolve the grid's menu, every row of which takes
 * a revision: thirteen rows, all greyed, which reads as the app being broken rather than
 * as the row being a different kind of thing. So the rule is not "these ids are on it" but
 * the one that failed: with one of those rows selected, every row can actually be clicked.
 */
describe('the working-directory menu', () =>
{
  /** A context shaped like the working-tree row being the selection, with something to commit. */
  const artificial = {
    hasRepo: true,
    hasSuperproject: false,
    isMidOperation: false,
    hasChanges: true,
    selectionCount: 1,
    hasArtificialSelection: true,
    fileSelectionCount: 0,
    focusedPane: 'grid',
    fileSource: 'workingTree',
    stagingSide: null,
    stagingSelectionCount: 0,
    selectedNode: null,
    selectedFile: null
  } as const;

  it('offers nothing that a working-tree row cannot do', async () =>
  {
    const { workingDirectoryMenu } = await import('@renderer/menus/revisionGrid.js');
    const { resolveMenu } = await import('@renderer/menus/resolve.js');

    const rows = resolveMenu(workingDirectoryMenu, artificial);
    const commands = rows.filter((row) => row.kind === 'command');
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((row) => !row.enabled).map((row) => row.id)).toEqual([]);
  });

  it('is not the grid menu, which greys entirely on these rows', async () =>
  {
    // The positive twin: without it the test above would pass on any menu that happened to
    // be short, and this is the state that made the whole thing necessary.
    const { revisionGridMenu } = await import('@renderer/menus/revisionGrid.js');
    const { resolveMenu } = await import('@renderer/menus/resolve.js');

    const rows = resolveMenu(revisionGridMenu(), artificial).filter(
      (row) => row.kind === 'command'
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.enabled)).toBe(true);
  });
});

describe('the command modules and the menu bar agree', () =>
{
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

  const menuIds = [...source('main/menu.ts').matchAll(/cmd\('[^']*',\s*'([^']+)'/g)].map(
    (match) => match[1] as string
  );

  /**
   * `view.column.<id>` is registered in a loop over the column list rather than written
   * out, so the scan above cannot see it. The prefix is the exception, not each id.
   */
  const generated = /^view\.column\./;

  it('dispatches no id that nothing registers', () =>
  {
    const dead = menuIds.filter((id) => !registeredIds.has(id) && !generated.test(id));
    expect(dead).toEqual([]);
  });

  /**
   * A menu row shows the accelerator its command actually has, and no other.
   *
   * Two directions, both of which had gone wrong. `remote.pull` and `remote.push` carried
   * `Mod+Shift+L` and `Mod+Shift+P` in the registry and showed nothing in the menu, so the
   * two commands people reach for most looked like they had no shortcut. `repo.close` and
   * `branch.create` had the opposite: an accelerator written only here, which fires because
   * Electron binds it, but which the palette and the shortcuts window cannot know about.
   *
   * The second of those is the worse one. An app-menu accelerator is live in *every* window,
   * so `branch.create`'s `Cmd+Shift+B` reached the commit screen, where `staging.createBranch`
   * claimed the same keystroke from the registry: one key, two commands, one window.
   */
  it('shows each row the accelerator its command has', () =>
  {
    const drift: string[] = [];
    for (const match of source('main/menu.ts').matchAll(
      /cmd\('([^']*)',\s*'([^']+)'(?:,\s*'([^']+)')?\)/g
    ))
    {
      const [, , id, accelerator] = match;
      const command = registryLabels.get(id!);
      if (!command)
      {
        continue;
      }
      // `CmdOrCtrl` is Electron's spelling of the registry's `Mod`, and `Cmd` is the
      // macOS-only form the app menu uses for Settings.
      const shown = (accelerator ?? '').replace(/^CmdOrCtrl|^Cmd/, 'Mod');
      const declared = command.keys?.[0] ?? '';
      if (shown !== declared)
      {
        drift.push(`${id}: menu shows ${shown || 'none'}, registry declares ${declared || 'none'}`);
      }
    }
    expect(drift).toEqual([]);
  });

  /**
   * A row opening a window says so, on both surfaces.
   *
   * The trailing ellipsis is the app's one piece of punctuation with a meaning attached, so
   * a row carrying it where the registry does not, or the reverse, is a promise about what
   * clicking does. The *words* are free to differ: `History` ▸ "Cherry Pick…" is right in a
   * menu that names its subject, and "Cherry-pick This Commit…" is right in a palette with
   * no surroundings to lean on. That is what a menu row's label override is for, and holding
   * the two equal would force one surface into the other's wording.
   */
  it('agrees with the registry on which rows open a window', () =>
  {
    const ELLIPSIS = '…';
    const drift: string[] = [];
    for (const match of source('main/menu.ts').matchAll(/cmd\('([^']*)',\s*'([^']+)'/g))
    {
      const [, label, id] = match;
      const command = registryLabels.get(id!);
      if (!command)
      {
        continue;
      }
      if (label!.endsWith(ELLIPSIS) !== command.label.endsWith(ELLIPSIS))
      {
        drift.push(`${id}: menu "${label}", registry "${command.label}"`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('found the menu and the registrations at all', () =>
  {
    // A regex that silently matched nothing would make the test above pass for ever.
    expect(menuIds.length).toBeGreaterThan(50);
    expect(registeredIds.size).toBeGreaterThan(100);
  });

  /**
   * No menu is a dump.
   *
   * `Commands` once held 24 rows spanning commit, remote, stash, branch, tag, reset and
   * patch, which is what a menu becomes when it is named for something every row
   * satisfies. A menu the eye cannot take in is one the user scans instead of predicting,
   * so the ceiling is part of the design rather than a tidiness preference.
   *
   * Counted in the menu's own rows: `cmd(` at the top level of a submenu block, which the
   * file's indentation distinguishes from the rows inside a nested submenu. The `role:`
   * items are not counted, being the conventional zoom and window entries a reader skips.
   *
   * It measures the menus written inline in the template, which is all of them but File:
   * that one is built by a helper defined above the template, so its rows fall outside
   * every segment and count as none. Worth knowing rather than working around, since File
   * is the one menu whose contents are fixed by what a repository is.
   */
  it('gives each menu a mnemonic no other menu claims', () =>
  {
    // Found by reading the built menu, not by reading the source: `&Repository` and
    // `&Remote` both asked for R, which nothing here would have said.
    const letters = new Map<string, string[]>();
    for (const match of source('main/menu.ts').matchAll(/label: '([^']*&[^']*)'/g))
    {
      const label = match[1]!;
      const letter = label[label.indexOf('&') + 1]!.toLowerCase();
      letters.set(letter, [...(letters.get(letter) ?? []), label]);
    }

    const shared = [...letters.entries()]
      .filter(([, labels]) => labels.length > 1)
      .map(([letter, labels]) => `${letter}: ${labels.join(' and ')}`);
    expect(shared).toEqual([]);
  });

  it('gives no menu more rows than the eye can take in', () =>
  {
    const MAX_ROWS = 12;
    const TOP_LEVEL_ROW = /^ {8}cmd\(/gm;

    const text = source('main/menu.ts');
    // Keyed on the `&` mnemonic, which only a top-level menu carries: a submenu's label
    // would otherwise end its parent's segment and undercount the menu it sits in.
    const menus = [...text.matchAll(/label: '([^']*&[^']*)'/g)];
    expect(menus.length).toBeGreaterThan(5);

    const oversized: string[] = [];
    for (const [index, match] of menus.entries())
    {
      const from = match.index;
      const to = menus[index + 1]?.index ?? text.length;
      const rows = text.slice(from, to).match(TOP_LEVEL_ROW)?.length ?? 0;
      if (rows > MAX_ROWS)
      {
        oversized.push(`${match[1]!.replace('&', '')} has ${rows} rows`);
      }
    }
    expect(oversized).toEqual([]);
  });
});
