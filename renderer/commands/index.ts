/**
 * Register every command group. Commands declared before built (menu shows shape early).
 */

import { defineCommand, hasRepo } from './registry.js';
import { registerCopyCommands } from './copy.js';
import { registerDiffCommands } from './diff.js';
import { registerFileCommands } from './file.js';
import { implementFileCommands } from './file.actions.js';
import { registerFileListCommands } from './fileList.js';
import { registerWorkingFileCommands } from './workingFile.js';
import { registerNavigateCommands } from './navigate.js';
import { registerObjectCommands } from './objects.js';
import { implementObjectCommands } from './objects.actions.js';
import { registerPanelCommands } from './panel.js';
import { registerMaintenanceCommands } from './maintenance.js';
import { implementMaintenanceCommands } from './maintenance.actions.js';
import { registerRevisionCommands } from './revision.js';
import { registerSearchCommands } from './search.js';
import { implementRevisionCommands } from './revision.actions.js';
import { registerStagingCommands } from './staging.js';
import { implementStagingCommands } from './staging.actions.js';
import { registerViewCommands } from './view.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { api, toMessage } from '@renderer/api.js';


/**
 * Whether this renderer process has already built its registry.
 *
 * There is more than one process. The repository window registers from `App.vue`; a
 * dialog window mounts `DialogHost` instead and so starts with an empty registry, which
 * is fine for every dialog except the one whose whole content *is* the registry. That
 * one calls this too, and `defineCommand` throws on a duplicate id: so the second call
 * has to be a no-op rather than an error.
 */
let registered = false;

export function registerCommands(): void
{
  if (registered)
  {
    return;
  }
  registered = true;

  // ── Repository ──────────────────────────────────────────────────────────────
  defineCommand({
    id: 'repo.open',
    label: 'Open Repository…',
    group: 'Repository',
    keys: ['Mod+O'],
    run: () => useRepoStore().open()
  });

  // No `when`, like `repo.open` above: these three are how a repository comes to be open,
  // so requiring one would be a circle. They are also the only dialogs the welcome screen
  // can raise, which is the state the app starts in on a machine that has never run it.
  defineCommand({
    id: 'repo.clone',
    label: 'Clone Repository…',
    group: 'Repository',
    run: () => useUiStore().openDialog('repo.clone')
  });

  defineCommand({
    id: 'repo.init',
    label: 'New Repository…',
    group: 'Repository',
    run: () => useUiStore().openDialog('repo.init')
  });

  defineCommand({
    id: 'repo.close',
    label: 'Close Repository',
    group: 'Repository',
    keys: ['Mod+Shift+W'],
    when: hasRepo,
    run: () => useRepoStore().close()
  });

  defineCommand({
    id: 'repo.reveal',
    label: 'Open in Finder',
    group: 'Repository',
    when: hasRepo,
    run: () =>
    {
      const { repo } = useRepoStore();
      if (repo)
      {
        void api['repo:openPath'](repo.path).catch((err: unknown) =>
          useUiStore().toast(toMessage(err), 'error')
        );
      }
    }
  });

  // Beside "Open in Finder", and the same shape: hand the repository's directory to
  // something outside the app. Which terminal is main's decision: see `repo:openTerminal`.
  defineCommand({
    id: 'repo.terminal',
    label: 'Open Terminal Here',
    group: 'Repository',
    when: hasRepo,
    run: async () =>
    {
      const { repo } = useRepoStore();
      if (!repo)
      {
        return;
      }
      try
      {
        await api['repo:openTerminal'](repo.path);
      }
      catch (err)
      {
        useUiStore().toast(toMessage(err), 'error');
      }
    }
  });

  // Up one level out of a submodule: the one switcher row that is a command rather than
  // a path, because its operand is
  // "wherever this repository is nested" rather than something the user picked.
  // `when` reads the store rather than the context: it runs on every keystroke, and a
  // store lookup is a map read, but it is the only such predicate: anything walking a
  // list belongs in `CommandContext`.
  defineCommand({
    id: 'repo.goToSuperproject',
    label: 'Go to Superproject',
    group: 'Repository',
    when: () => useRepoStore().repo?.superprojectPath != null,
    run: () =>
    {
      const path = useRepoStore().repo?.superprojectPath;
      if (path)
      {
        void useRepoStore().open(path);
      }
    }
  });

  defineCommand({
    id: 'palette.open',
    label: 'Command Palette…',
    group: 'View',
    keys: ['Mod+P'],
    run: () => useUiStore().openPalette()
  });

  // ── Help ────────────────────────────────────────────────────────────────────
  defineCommand({
    id: 'help.shortcuts',
    label: 'Keyboard Shortcuts',
    group: 'Help',
    run: () => useUiStore().openDialog('shortcuts')
  });

  defineCommand({
    id: 'help.saveDiagnostics',
    label: 'Save Diagnostics…',
    group: 'Help',
    run: async () =>
    {
      const ui = useUiStore();
      const path = await api['diagnostics:save']();
      if (path)
      {
        ui.toast(`Diagnostics saved to \`${path}\``, 'info');
      }
    }
  });

  defineCommand({
    id: 'help.about',
    label: 'About gitext',
    group: 'Help',
    run: () => useUiStore().openDialog('about')
  });

  defineCommand({
    id: 'settings.open',
    label: 'Settings…',
    group: 'Tools',
    keys: ['Mod+,'],
    run: () => useUiStore().openDialog('settings')
  });

  // Each group lives in its own module; this is the one place they are registered.
  // Order matters only in that ids must not collide: `defineCommand` throws if they
  // do, which is how a copy-pasted id is caught at startup rather than in a menu.
  registerViewCommands();
  registerDiffCommands();
  registerFileCommands();
  registerFileListCommands();
  registerWorkingFileCommands();
  registerNavigateCommands();
  registerSearchCommands();
  registerCopyCommands();
  registerRevisionCommands();
  registerMaintenanceCommands();
  registerObjectCommands();
  registerPanelCommands();
  registerStagingCommands();

  // Phase 3: add `run` to the commands declared above.
  implementRevisionCommands();
  implementMaintenanceCommands();
  implementObjectCommands();
  implementFileCommands();
  implementStagingCommands();
}
