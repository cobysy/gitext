/**
 * Implementations for the commit-screen commands declared in `staging.ts`. Imports
 * stores: must NOT be listed in `tsconfig.node.json`. The `checked` predicates are what
 * make the view menu readable: every one is a state, not an action.
 */

import { api, toMessage } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { getCommand, implementCommand } from './registry.js';
import { applyPrefix, nextPrefix, withMessageText } from '@renderer/model/commitMessage.js';
import { toRepoRelative } from '@renderer/model/paths.js';
import { buildSubmoduleSummaryArgs } from '@renderer/model/args/submodule.js';
import { PATH_SEPARATOR } from '@shared/diff.js';
import { READS, STAGING } from '@shared/invalidation.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import {
  COMMIT_PANE_DIFF,
  COMMIT_PANE_MESSAGE,
  STAGING_SIDE_STAGED,
  STAGING_SIDE_UNSTAGED,
  type CommitPane
} from '@renderer/stores/staging/types.js';
import { useUiStore } from '@renderer/stores/ui.js';
import type { Settings } from '@shared/types.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const DISCARD_SCOPE_ALL = 'all';
const DISCARD_SCOPE_UNSTAGED = 'unstaged';
const CMD_ADD = 'add';

/** Attach a `checked` predicate to an already-declared command. */
function setChecked(id: string, checked: () => boolean): void
{
  const command = getCommand(id);
  if (command)
  {
    command.checked = checked;
  }
}

/** A boolean setting, toggled and ticked. */
function toggleSetting(id: string, key: keyof Settings): void
{
  implementCommand(id, () =>
  {
    const settings = useSettingsStore();
    void settings.patch({ [key]: !settings.settings[key] } as Partial<Settings>);
  });
  setChecked(id, () => useSettingsStore().settings[key] === true);
}

/** One of a set of mutually exclusive settings: a radio row. */
function chooseSetting<K extends keyof Settings>(id: string, key: K, value: Settings[K]): void
{
  implementCommand(id, () =>
  {
    void useSettingsStore().patch({ [key]: value } as Partial<Settings>);
  });
  setChecked(id, () => useSettingsStore().settings[key] === value);
}

export function implementStagingCommands(): void
{
  // ── The lists' shape ───────────────────────────────────────────────────────
  chooseSetting('staging.viewFlat', 'stagingListView', 'flat');
  chooseSetting('staging.viewTree', 'stagingListView', 'tree');
  chooseSetting('staging.groupByExtension', 'stagingListView', 'extension');
  chooseSetting('staging.groupByStatus', 'stagingListView', 'status');
  toggleSetting('staging.denseTree', 'stagingDenseTree');
  toggleSetting('staging.toggleFilter', 'stagingFilterVisible');

  // ── What the lists show ────────────────────────────────────────────────────
  // Each of these changes what git is asked, so the lists are re-read rather than
  // re-filtered: an ignored file is absent from the listing entirely until asked for.
  for (const [id, key] of [
    ['staging.showUntracked', 'stagingShowUntracked'],
    ['staging.showIgnored', 'stagingShowIgnored'],
    ['staging.showSkipWorktree', 'stagingShowSkipWorktree'],
    ['staging.showAssumeUnchanged', 'stagingShowAssumeUnchanged']
  ] as const)
  {
    implementCommand(id, async () =>
    {
      const settings = useSettingsStore();
      await settings.patch({ [key]: !settings.settings[key] } as Partial<Settings>);
      await useStagingStore().refresh();
    });
    setChecked(id, () => useSettingsStore().settings[key] === true);
  }

  // ── Selection ──────────────────────────────────────────────────────────────
  implementCommand('staging.selectAll', () =>
  {
    const staging = useStagingStore();
    staging.selectAll(staging.side);
  });
  implementCommand('staging.selectNext', () => useStagingStore().step(1));
  implementCommand('staging.selectPrevious', () => useStagingStore().step(-1));

  // ── Moving everything ──────────────────────────────────────────────────────
  implementCommand('staging.stageAll', () => useStagingStore().stageAll());
  implementCommand('staging.unstageAll', () => useStagingStore().unstageAll());
  implementCommand('staging.refresh', () => useStagingStore().refresh());

  // ── Throwing work away ─────────────────────────────────────────────────────

  // The three most destructive rows here open dialogs, the same ones the menu bar
  // opens, so there's one preview and plan per operation rather than one per surface.
  implementCommand('staging.resetAllChanges', () =>
    useUiStore().openDialog('reset.changes', { discardScope: DISCARD_SCOPE_ALL })
  );

  implementCommand('staging.resetUnstagedChanges', () =>
    useUiStore().openDialog('reset.changes', { discardScope: DISCARD_SCOPE_UNSTAGED })
  );

  // The same operation as the menu bar's Undo Last Commit, so the same window: `reset
  // --soft HEAD~1` is one thing, however it is reached.
  implementCommand('staging.resetSoft', () => useUiStore().openDialog('commit.undo'));

  implementCommand('staging.stashStaged', () =>
    useUiStore().openDialog('stash', { stagedOnly: true })
  );

  // ── What this commit is ────────────────────────────────────────────────────
  implementCommand('staging.amend', () =>
  {
    const staging = useStagingStore();
    staging.amend = !staging.amend;
  });
  setChecked('staging.amend', () => useStagingStore().amend);

  toggleSetting('staging.noVerify', 'commitNoVerify');
  toggleSetting('staging.closeWhenDone', 'commitCloseWhenDone');

  // ── What goes in the message box ───────────────────────────────────────────
  // Two pickers, each a submenu of rows carrying their own operand (`commitOptionsMenu`).
  // Nothing here replaces what's typed: an old message chosen after a subject goes below it.

  implementCommand<{ text?: string }>('staging.recentMessages', (options) =>
  {
    const staging = useStagingStore();
    // The newest, when reached without a row naming one (from the palette, with nothing to pick from).
    const text = options?.text ?? useStagingStore().recentMessages[0] ?? '';
    staging.message = withMessageText(staging.message, text);
  });

  /**
   * The conventional prefix, from a row that names one, or the next one along. A bare
   * hotkey press cycles rather than opening anything: `Mod+T` has no operand to carry,
   * so one press labels a commit and a second corrects it.
   */
  implementCommand<{ prefix?: string }>('staging.conventionalPrefix', (options) =>
  {
    const staging = useStagingStore();
    const prefix = options?.prefix ?? nextPrefix(staging.message);
    staging.message = applyPrefix(staging.message, prefix);
  });

  /**
   * Who the commit records as its author: `--author`, for this commit only. Toggled
   * off by picking the same person again, the only way back to git's own answer from a menu of people.
   */
  implementCommand<{ author?: string }>('staging.changeAuthor', (options) =>
  {
    const staging = useStagingStore();
    const picked = options?.author ?? '';
    if (staging.author === picked)
    {
      staging.author = '';
      return;
    }
    staging.author = picked;
  });

  /**
   * Describe what the submodules moved past, in the message box. `git submodule
   * summary --cached` reads the index; its output goes into the message since the
   * reason to look is to say so in the commit.
   */
  implementCommand('staging.submoduleSummary', async () =>
  {
    const staging = useStagingStore();
    const repoPath = useRepoStore().repo?.path;
    const ui = useUiStore();
    if (!repoPath)
    {
      return;
    }
    try
    {
      const summary = await api['git:run'](repoPath, buildSubmoduleSummaryArgs(), READS);
      if (!summary.trim())
      {
        ui.toast('No submodule has moved.', 'info');
        return;
      }
      staging.message = withMessageText(staging.message, summary);
    }
    catch (err)
    {
      ui.toast(toMessage(err), 'error');
    }
  });

  /**
   * Record this submodule's new commit in the repository that contains it: `add` on
   * the submodule's own path, in the *superproject*, not this one. Neither window
   * changes what it shows, so the toast is what says it worked. Only offered from a
   * repository that has one; `superprojectPath` null is what greys the row.
   */
  implementCommand('staging.stageInSuperproject', async () =>
  {
    const repo = useRepoStore().repo;
    const ui = useUiStore();
    const parent = repo?.superprojectPath;
    if (!repo || !parent)
    {
      return;
    }
    // A submodule sits *under* its superproject; anything that climbs out is a repository this command can't describe.
    const within = toRepoRelative(parent, repo.path);
    if (within.startsWith('../') || within.startsWith('/'))
    {
      ui.toast('This worktree is not inside its superproject.', 'error');
      return;
    }
    try
    {
      await runConsoleSteps(parent, [{ label: 'Staging the submodule', argv: [CMD_ADD, PATH_SEPARATOR, within] }], STAGING);
      ui.toast(`Staged ${within} in the superproject.`);
    }
    catch (err)
    {
      ui.toast(toMessage(err), 'error');
    }
  });

  // ── Where the keyboard goes ────────────────────────────────────────────────
  // The screen owns its panes' elements, so these ask rather than reach: see
  // `commitPaneRequest` in `stores/ui.ts`. `Mod+1`-`4` reach the same function
  // directly, since this window has no registry accelerators.
  const focusPane = (pane: CommitPane) => () => useUiStore().focusCommitPane(pane);

  implementCommand('staging.focusUnstaged', focusPane(STAGING_SIDE_UNSTAGED));
  implementCommand('staging.focusStaged', focusPane(STAGING_SIDE_STAGED));
  implementCommand('staging.focusDiff', focusPane(COMMIT_PANE_DIFF));
  implementCommand('staging.focusMessage', focusPane(COMMIT_PANE_MESSAGE));

  implementCommand('staging.resetAuthor', () =>
  {
    const staging = useStagingStore();
    staging.resetAuthor = !staging.resetAuthor;
  });
  setChecked('staging.resetAuthor', () => useStagingStore().resetAuthor);

  // Closes on success like the buttons do: the palette reaching this must not leave
  // the window up over an empty form.
  implementCommand('staging.commitAndPush', async () =>
  {
    if (await useStagingStore().commit({ push: true }))
    {
      await api['dialog:close']();
    }
  });

  // HEAD stated rather than left to the dialog's default: the commit screen's operand is
  // where you are, and a payload that says so is one a reader can check.
  implementCommand('staging.createBranch', () =>
    useUiStore().openDialog('branch.create', { ref: HEAD_REF })
  );

  // ── The message ────────────────────────────────────────────────────────────
  implementCommand('staging.addSelectionToMessage', () =>
  {
    const staging = useStagingStore();
    const text = staging.pickedLineText;
    if (!text)
    {
      useUiStore().toast('Select lines in the diff first.', 'info');
      return;
    }
    if (staging.message)
    {
      staging.message = `${staging.message.replace(/\s*$/, '')}\n${text}`;
    }
    else
    {
      staging.message = text;
    }
  });
}
