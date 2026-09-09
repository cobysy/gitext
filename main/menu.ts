/**
 * The native application menu. Menu items carry no logic: each emits a command id
 * the renderer's registry resolves and runs (§7). The wire runs both ways: `when`/
 * `checked` predicates live in the renderer's stores, so windows report them
 * (`menu:state`) and `reportMenuState` applies them.
 */

import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuItemStates } from '@shared/contract.js';
import { raiseWindow } from './background.js';
import { modalChildOf, ownerWindow, repoWindows } from './dialogs.js';
import { isMac as isMacPlatform } from './platform.js';

/**
 * What each window last reported about its own commands, keyed by its window id. Per
 * window, not one global map: two repositories can be open, and the menu describes the one in front.
 */
const statesByWindow = new Map<number, MenuItemStates>();

/** The state the built menu is currently drawn from. Empty until a window reports. */
let shownStates: MenuItemStates = {};

/**
 * The ids this menu dispatches, collected as `cmd` builds them. A report names every
 * registered command, most living only in the palette; comparing against this keeps a
 * redraw to what the menu bar can actually show.
 */
const menuIds = new Set<string>();

/**
 * Deliver a command id to the repository window, never to a dialog: the focused
 * window is often a dialog, which binds only Escape/Enter and would drop every
 * menu-bar command made while it's up. `ownerWindow` walks to the owning repository window.
 *
 * With a dialog open the command isn't delivered at all, and the dialog is raised
 * instead: a modal disables its parent's input but not the menu, so without this a
 * command would run against a window the user can't touch.
 */
function send(commandId: string): void
{
  const win = ownerWindow(BrowserWindow.getFocusedWindow()) ?? repoWindows()[0];
  if (!win)
  {
    return;
  }

  const dialog = modalChildOf(win);
  if (dialog)
  {
    raiseWindow(dialog);
    return;
  }

  win.webContents.send('event:command', commandId);
}

/**
 * A menu item that dispatches a registry command id. Greyed when the reporting
 * window says it can't run, drawn as a checkbox (or a radio, for a pick-one set) exactly
 * when it reports a `checked`,
 * from the same predicates the palette and context menus resolve. Before any window
 * has reported, every row is a plain enabled item.
 */
function cmd(
  label: string,
  id: string,
  accelerator?: string
): MenuItemConstructorOptions
{
  menuIds.add(id);
  const state = shownStates[id];
  if (!state)
  {
    return { label, accelerator, click: () => send(id) };
  }
  if (state.checked === undefined)
  {
    return { label, accelerator, enabled: state.enabled, click: () => send(id) };
  }
  // A pick-one set is drawn as a radio, everything else as a checkbox. macOS marks the
  // two differently, and the difference is exactly "one of these" against "independent".
  let type: 'checkbox' | 'radio';
  if (state.radioGroup)
  {
    type = 'radio';
  }
  else
  {
    type = 'checkbox';
  }
  return {
    label,
    accelerator,
    enabled: state.enabled,
    type,
    checked: state.checked,
    click: () => send(id)
  };
}

const SEP: MenuItemConstructorOptions = { type: 'separator' };

/** The app's own menu, its name, About, Settings, Quit, which only macOS shows at all. */
function appMenu(isMac: boolean): MenuItemConstructorOptions[]
{
  if (!isMac)
  {
    return [];
  }
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        SEP,
        cmd('Settings…', 'settings.open', 'Cmd+,'),
        SEP,
        { role: 'services' },
        SEP,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        SEP,
        { role: 'quit' }
      ]
    }
  ];
}

/** The File menu's items. On macOS, Quit lives in the app menu instead. */
function fileMenu(isMac: boolean): MenuItemConstructorOptions[]
{
  const items = [
    cmd('Open Repository…', 'repo.open', 'CmdOrCtrl+O'),
    cmd('Clone Repository…', 'repo.clone'),
    cmd('New Repository…', 'repo.init'),
    SEP,
    cmd('Go to Superproject', 'repo.goToSuperproject'),
    SEP,
    cmd('Open in Finder', 'repo.reveal'),
    cmd('Open Terminal Here', 'repo.terminal'),
    SEP,
    // A submenu here rather than rows on a subject menu: all three read or write a file,
    // which is what this menu is for, and none of them is reached often enough to earn a
    // place beside the branch and remote operations.
    {
      label: 'Patch',
      submenu: [
        cmd('Format Patch…', 'patch.format'),
        cmd('Apply Patch…', 'patch.apply'),
        cmd('View Patch File…', 'patch.view')
      ]
    },
    SEP,
    cmd('Close Repository', 'repo.close', 'CmdOrCtrl+Shift+W'),
    SEP,
    // `Cmd+W` closes the window here, the way it does in every other Mac app. It used to
    // close the repository and leave an empty frame with no keyboard way out; Close
    // Repository keeps the action and moves one modifier over.
    { role: 'close' } as MenuItemConstructorOptions
  ];
  if (!isMac)
  {
    items.push(SEP, { role: 'quit' });
  }
  return items;
}

function buildMenu(): Menu
{
  const isMac = isMacPlatform();

  const template: MenuItemConstructorOptions[] = [
    ...appMenu(isMac),
    {
      label: '&File',
      submenu: fileMenu(isMac)
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        SEP,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        SEP,
        // Was `Find…` on `CmdOrCtrl+F`, dispatching an id no module registered: the row
        // raised "unknown command" and the accelerator shadowed Monaco's own find widget
        // in the diff pane. Now opens the search that exists, and Cmd+F belongs to the pane again.
        // Clipboard operations, where the OS puts them, and the only route to these that
        // does not need a commit under the pointer. The revision grid renders the same
        // submenu from the same declaration.
        {
          // Not plain "Copy": the system's own Copy sits three rows above, and two rows
          // reading the same in one menu is a coin toss. The grid's version stays "Copy",
          // where you right-clicked the commit and the menu can lean on that.
          label: 'Copy from Commit',
          submenu: [
            cmd('Copy SHA-1', 'copy.sha', 'CmdOrCtrl+Shift+S'),
            cmd('Copy Short SHA-1', 'copy.shortSha'),
            cmd('Copy Message Subject', 'copy.subject'),
            cmd('Copy Full Message', 'copy.message'),
            cmd('Copy Author', 'copy.author'),
            cmd('Copy Branch or Tag Name', 'copy.refs')
          ]
        },
        SEP,
        cmd('Find in Files…', 'search.grep', 'CmdOrCtrl+Shift+F'),
        cmd("Find in This Commit's Files…", 'search.grepCommit')
      ]
    },
    // The long list of grid toggles lives here and only here: mirroring it into the
    // grid's context menu puts 22 rows in front of every right-click.
    {
      label: '&View',
      submenu: [
        // The palette is a way to show every command at once, which is this menu's
        // subject. It had a `Tools` menu of its own, two rows both duplicated elsewhere.
        cmd('Command Palette…', 'palette.open', 'CmdOrCtrl+P'),
        SEP,
        cmd('Refresh', 'view.refresh', 'F5'),
        SEP,
        // The third state (Filtered) and what it walks (pattern, reflog,
        // remotes/tags/stashes, Advanced Filter) live in Settings, not here: preferences,
        // not mid-session reaches. All five still `defineCommand`d in view.ts.
        cmd('Show All Branches', 'view.branchesAll'),
        cmd('Show Current Branch Only', 'view.branchesCurrent'),
        // The window that decides what the third state walks. It had no door at all: a
        // whole filtering window reachable only by knowing its name in the palette.
        cmd('Advanced Filter…', 'view.advancedFilter'),
        {
          label: 'Columns',
          submenu: [
            cmd('Revision Graph', 'view.column.graph'),
            cmd('Author', 'view.column.author'),
            cmd('Date', 'view.column.date'),
            cmd('SHA-1', 'view.column.sha')
          ]
        },
        SEP,
        // The graph's shape and colouring settings live in Settings > Graph, not here:
        // preferences, not mid-session reaches. Still `defineCommand`d in view.ts.
        cmd('Highlight Selected Branch', 'view.highlightBranch'),
        SEP,
        cmd('Toggle Command Log', 'view.toggleCommandLog', 'CmdOrCtrl+`'),
        cmd('Toggle Left Panel', 'view.toggleLeftPanel', 'CmdOrCtrl+B'),
        cmd('Toggle Commit Details', 'view.toggleCommitDetails'),
        cmd('Toggle Files and Diff', 'view.toggleFilePane'),
        SEP,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        SEP,
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: '&Navigate',
      submenu: [
        cmd('Backward', 'navigate.back', 'Alt+Left'),
        cmd('Forward', 'navigate.forward', 'Alt+Right'),
        SEP,
        // Parents are older and drawn below, children newer and drawn above, so the keys point the way the selection moves.
        cmd('Go to Parent', 'navigate.goToParent', 'CmdOrCtrl+Down'),
        cmd('Go to Child', 'navigate.goToChild', 'CmdOrCtrl+Up'),
        cmd('Go to Current Revision', 'navigate.goToHead', 'CmdOrCtrl+Shift+C'),
        cmd('Go to Commit…', 'navigate.goToCommit', 'CmdOrCtrl+Shift+G'),
        SEP,
        cmd('Quick Search Next', 'navigate.quickSearchNext', 'Alt+Down'),
        cmd('Quick Search Previous', 'navigate.quickSearchPrevious', 'Alt+Up')
      ]
    },
    {
      label: '&Repository',
      submenu: [
        cmd('Manage Submodules…', 'submodule.manage'),
        cmd('Update All Submodules', 'submodule.updateAll'),
        cmd('Synchronize Submodules', 'submodule.sync'),
        SEP,
        cmd('Manage Worktrees…', 'worktree.manage'),
        cmd('Create Worktree…', 'worktree.create'),
        SEP,
        cmd('Edit .gitignore…', 'repo.editGitignore'),
        cmd('Edit .git/info/exclude…', 'repo.editExclude'),
        cmd('Edit .gitattributes…', 'repo.editGitattributes'),
        cmd('Edit .git/config…', 'repo.editConfig'),
        SEP,
        {
          label: 'Git Maintenance',
          submenu: [
            cmd('Compress Git Database…', 'repo.gc'),
            cmd('Recover Lost Objects…', 'repo.fsck'),
            cmd('Delete index.lock…', 'repo.deleteIndexLock')
          ]
        }
      ]
    },
    // The four subject menus. A menu is named for a noun the user already holds in mind,
    // so they can predict what is in it before opening it: `Commands` could not be
    // predicted, because everything in the app is a command.
    {
      label: '&Changes',
      submenu: [
        // Committing is the primary thing you do *to* uncommitted work, so it leads the
        // menu holding the alternatives you pick between when the tree is dirty.
        cmd('Commit…', 'commit.open', 'CmdOrCtrl+Enter'),
        SEP,
        cmd('Stash Changes…', 'stash.save'),
        cmd('Manage Stashes…', 'stash.manage'),
        SEP,
        cmd('Reset Changes…', 'reset.changes'),
        cmd('Clean Working Directory…', 'workdir.clean'),
        SEP,
        cmd('Solve Merge Conflicts…', 'conflicts.resolve')
      ]
    },
    // Acting on a commit that already exists, which is a different subject from the work
    // in the tree. Named `History` rather than `Commit` so no two menus compete over one
    // word: `Changes` already carries the verb.
    {
      label: 'Hi&story',
      submenu: [
        cmd('Undo Last Commit…', 'commit.undo'),
        cmd('Reword Commit…', 'commit.reword'),
        SEP,
        cmd('Cherry Pick…', 'commit.cherryPick'),
        cmd('Revert…', 'commit.revert'),
        SEP,
        cmd('Checkout Revision…', 'commit.checkout'),
        cmd('Archive Revision…', 'commit.archive'),
        SEP,
        cmd('Compare with Current Branch…', 'compare.withCurrent'),
        cmd('Compare Selected Commits…', 'compare.selected')
      ]
    },
    {
      label: '&Branch',
      submenu: [
        cmd('Create Branch…', 'branch.create', 'CmdOrCtrl+Shift+B'),
        cmd('Checkout Branch…', 'branch.checkout'),
        SEP,
        cmd('Merge…', 'branch.merge'),
        // `rebaseAdvanced`, not `rebase`: the latter takes the grid's selected commit, so
        // a menu-bar row for it greys until you have clicked one. This one asks for the
        // ref, which is what a menu reached without a commit under the pointer has to do.
        cmd('Rebase…', 'branch.rebaseAdvanced'),
        cmd('Reset Current Branch to Here…', 'reset.currentBranch'),
        SEP,
        cmd('Rename…', 'branch.rename'),
        cmd('Set Upstream…', 'ref.setUpstream'),
        cmd('Delete Branches…', 'branch.delete'),
        SEP,
        // Housekeeping you go looking for, which is what a Branch menu is; it was in
        // Repository's maintenance submenu, two levels from the subject it acts on.
        cmd('Clean Up Merged Branches…', 'branch.cleanup'),
        SEP,
        // Two rows do not earn a menu of their own, and a tag is a ref like a branch.
        {
          label: 'Tag',
          submenu: [cmd('Create Tag…', 'tag.create'), cmd('Delete Tag…', 'tag.delete')]
        }
      ]
    },
    {
      // `Re&mote`: `R` is Repository's, and two menus cannot share a mnemonic.
      label: 'Re&mote',
      submenu: [
        cmd('Pull / Fetch…', 'remote.pull', 'CmdOrCtrl+Shift+L'),
        cmd('Push…', 'remote.push', 'CmdOrCtrl+Shift+P'),
        cmd('Fetch All Remotes', 'remote.fetchAll'),
        cmd('Fetch All Remotes and Prune', 'remote.fetchAllPrune'),
        SEP,
        cmd('Delete Remote Branches…', 'remote.deleteBranches'),
        SEP,
        cmd('Manage Remotes…', 'remote.manage')
      ]
    },
    // macOS expects a Window menu: without one, `Cmd+M` does nothing and there is no way
    // to cycle windows from the keyboard. `role` rows are the system's own.
    { role: 'windowMenu' },
    {
      label: '&Help',
      submenu: [
        cmd('Keyboard Shortcuts', 'help.shortcuts'),
        // Beside About rather than under Tools: the person reaching for it is answering
        // "how do I tell you what happened", which is what this menu is for.
        cmd('Save Diagnostics…', 'help.saveDiagnostics'),
        cmd('About gitext', 'help.about')
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

/** Whether `next` says anything different about a row this menu actually carries. */
function changesTheMenu(next: MenuItemStates): boolean
{
  for (const id of menuIds)
  {
    const before = shownStates[id];
    const after = next[id];
    if (before?.enabled !== after?.enabled || before?.checked !== after?.checked)
    {
      return true;
    }
  }
  return false;
}

/**
 * Redraw the menu from whichever repository window is in front. A no-op unless
 * something a row draws has moved, since this runs on every context change; rebuilding
 * is the only way to change `checked`/`enabled` on macOS, so rebuilding for nothing
 * would put that in the path of every keystroke.
 */
function refreshMenu(): void
{
  const owner = ownerWindow(BrowserWindow.getFocusedWindow()) ?? repoWindows()[0];
  let next: MenuItemStates;
  if (owner)
  {
    next = statesByWindow.get(owner.id) ?? {};
  }
  else
  {
    next = {};
  }

  if (!changesTheMenu(next))
  {
    return;
  }
  shownStates = next;
  Menu.setApplicationMenu(buildMenu());
}

/** A window reporting what its commands can do right now. */
export function reportMenuState(win: BrowserWindow, states: MenuItemStates): void
{
  if (!statesByWindow.has(win.id))
  {
    win.once('closed', () =>
    {
      statesByWindow.delete(win.id);
      refreshMenu();
    });
  }
  statesByWindow.set(win.id, states);
  refreshMenu();
}

/**
 * Build the menu and keep it describing the window in front. The focus listener is
 * what makes per-window states mean anything: switching repositories redraws the menu without that window having to report again.
 */
export function installMenu(): void
{
  Menu.setApplicationMenu(buildMenu());
  app.on('browser-window-focus', refreshMenu);
}
