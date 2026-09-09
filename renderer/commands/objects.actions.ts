/**
 * Phase 3 implementations for the left-panel commands declared in `objects.ts`.
 *
 * Imports stores and UI: must NOT be listed in `tsconfig.node.json`.
 * Called from `commands/index.ts` after `registerObjectCommands()`.
 */

import { implementCommand } from './registry.js';
import { buildFetchBranchArgs } from '@renderer/model/args/checkout.js';
import { checkoutRef, KIND_BRANCH, KIND_REMOTE_BRANCH, KIND_TAG } from './checkoutRef.js';
import { buildPullArgs, PULL_ACTION_FETCH } from '@renderer/model/args/pull.js';
import type { DialogPayload } from '@shared/dialogs.js';
import { useAfterGitOperation } from '@renderer/composables/useAfterGitOperation.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { api, toMessage } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const REMOTE_ALL = '--all';
const BRANCH_SCOPE_ALL = 'all';
const BRANCH_SCOPE_FILTERED = 'filtered';

function selectedRef(): string | undefined
{
  return useRepoObjectsStore().selected?.ref;
}

function selectedLabel(): string | undefined
{
  return useRepoObjectsStore().selected?.label;
}

/** The filesystem path a worktree or submodule node carries. */
function selectedPath(): string | undefined
{
  return useRepoObjectsStore().selected?.path;
}

export function implementObjectCommands(): void
{
  /** Check the selected ref out: `checkoutRef`, shared with the grid's own checkout rows. */
  implementCommand('ref.checkout', async () =>
  {
    const node = useRepoObjectsStore().selected;
    if (!node?.ref)
    {
      return;
    }
    let refKind: typeof KIND_TAG | typeof KIND_REMOTE_BRANCH | typeof KIND_BRANCH;
    switch (node.kind)
    {
      case KIND_TAG:
        refKind = KIND_TAG;
        break;
      case KIND_REMOTE_BRANCH:
        refKind = KIND_REMOTE_BRANCH;
        break;
      default:
        refKind = KIND_BRANCH;
        break;
    }
    await checkoutRef(node.ref, refKind);
  });

  /**
   * Walk this ref's history and nothing else: `filtered` scope with the ref as the
   * pattern, same as the Advanced Filter dialog's Branches field. A toggle: clicking
   * the ref already filtered to puts the scope back.
   */
  implementCommand('ref.filterGrid', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    const settings = useSettingsStore();
    const already =
      settings.settings.branchScope === BRANCH_SCOPE_FILTERED &&
      settings.settings.branchFilter === ref;
    if (already)
    {
      return settings.patch({ branchScope: BRANCH_SCOPE_ALL, branchFilter: '' });
    }
    return settings.patch({ branchScope: BRANCH_SCOPE_FILTERED, branchFilter: ref });
  });

  implementCommand('ref.merge', () =>
  {
    const ref = selectedRef();
    useUiStore().openDialog('branch.merge', { ref });
  });

  implementCommand('ref.rebaseCurrentOn', () =>
  {
    const ref = selectedRef();
    useUiStore().openDialog('branch.rebase', { ref });
  });

  implementCommand('ref.resetCurrentTo', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('reset.branch', { sha: ref });
  });

  implementCommand('ref.resetOtherBranchTo', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('reset.other', { sha: ref });
  });

  implementCommand('ref.createBranch', () =>
  {
    const ref = selectedRef();
    useUiStore().openDialog('branch.create', { ref });
  });

  implementCommand('ref.rename', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('branch.rename', { branchName: ref });
  });

  implementCommand('ref.setUpstream', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('branch.setUpstream', { branchName: ref });
  });

  // No operand: `ui.openDialog` fills in the repository path, and the dialog reads every branch itself.
  implementCommand('branch.cleanup', () => useUiStore().openDialog('branch.cleanup'));

  implementCommand('ref.delete', () =>
  {
    const node = useRepoObjectsStore().selected;
    if (!node)
    {
      return;
    }
    if (node.kind === KIND_TAG)
    {
      useUiStore().openDialog('tag.delete', { ref: node.ref });
    }
    else
    {
      useUiStore().openDialog('branch.delete', { branchName: node.ref });
    }
  });

  implementCommand('ref.push', () =>
  {
    const ref = selectedRef();
    useUiStore().openDialog('remote.push', { ref });
  });

  implementCommand('remote.pull', () =>
  {
    useUiStore().openDialog('remote.pull');
  });

  implementCommand('remote.push', () =>
  {
    useUiStore().openDialog('remote.push');
  });

  implementCommand('remote.manage', () =>
  {
    useUiStore().openDialog('remote.manage');
  });

  /**
   * A fetch row runs: no preview window, just the argv from the same tested table a
   * dialog would use, landing in the command log. On failure the dialog opens,
   * prefilled and in fetch mode. Returns whether it worked, since four rows are a fetch *and then something*.
   */
  async function fetchNow(argv: string[], onFailure: DialogPayload): Promise<boolean>
  {
    const path = useRepoStore().repo?.path;
    if (!path)
    {
      return false;
    }

    const ui = useUiStore();
    try
    {
      // A fetch moves remote-tracking refs and brings commits in; it never touches HEAD or either tree.
      // `true`: over the network, so the console watches it whatever the setting says,
      // the same as the Pull dialog's own fetch.
      await runConsoleSteps(path, [{ label: 'Fetching', argv }], ['refs', 'commits'], {
        console: true
      });
      await useAfterGitOperation().afterGitOperation();
      return true;
    }
    catch (e)
    {
      ui.toast(toMessage(e), 'error');
      ui.openDialog('remote.pull', { ...onFailure, pullAction: PULL_ACTION_FETCH });
      return false;
    }
  }

  implementCommand('remote.fetchAll', () =>
    // `--all` as the remote: every remote, not whichever the dialog would default to.
    fetchNow(buildPullArgs({ action: PULL_ACTION_FETCH, remote: REMOTE_ALL }), {
      remoteName: REMOTE_ALL
    })
  );

  implementCommand('remote.fetchAllPrune', () =>
    fetchNow(buildPullArgs({ action: PULL_ACTION_FETCH, remote: REMOTE_ALL, prune: true }), {
      remoteName: REMOTE_ALL,
      prune: true
    })
  );

  implementCommand('remote.fetch', () =>
  {
    const remote = selectedLabel();
    if (!remote)
    {
      return;
    }
    return fetchNow(buildPullArgs({ action: PULL_ACTION_FETCH, remote }), { remoteName: remote });
  });

  implementCommand('remote.fetchPrune', () =>
  {
    const remote = selectedLabel();
    if (!remote)
    {
      return;
    }
    return fetchNow(buildPullArgs({ action: PULL_ACTION_FETCH, remote, prune: true }), {
      remoteName: remote,
      prune: true
    });
  });

  /**
   * Switch a remote off, or back on: not a git operation, so not a dialog. The section
   * is renamed in `.git/config`; the remote keeps its URL. Three rows, one function.
   */
  async function setRemoteEnabled(enabled: boolean, thenFetch: boolean): Promise<void>
  {
    const name = useRepoObjectsStore().selected?.label;
    const path = useRepoStore().repo?.path;
    if (!name || !path)
    {
      return;
    }

    const ui = useUiStore();
    try
    {
      await api['remote:setEnabled'](path, name, enabled);
      await useAfterGitOperation().afterGitOperation();
      // The panel is the only place this is visible, worth one toast line saying it happened.
      let state: string;
      if (enabled)
      {
        state = 'active';
      }
      else
      {
        state = 'inactive';
      }
      ui.toast(`${name} is now ${state}.`, 'info');
    }
    catch (e)
    {
      ui.toast(toMessage(e), 'error');
      return;
    }

    // Fetching is why you switch one back on: "and Fetch" runs the same immediate fetch.
    if (thenFetch)
    {
      await fetchNow(buildPullArgs({ action: PULL_ACTION_FETCH, remote: name }), {
        remoteName: name
      });
    }
  }

  implementCommand('remote.enable', () => setRemoteEnabled(true, false));
  implementCommand('remote.enableAndFetch', () => setRemoteEnabled(true, true));
  implementCommand('remote.disable', () => setRemoteEnabled(false, false));

  // The same window as a single branch's Delete Remote Branch…, over the whole remote, nothing preselected.
  implementCommand('remote.deleteBranches', () =>
  {
    const name = useRepoObjectsStore().selected?.label;
    if (!name)
    {
      return;
    }
    useUiStore().openDialog('branch.deleteRemote', { remoteName: name });
  });

  implementCommand('remote.openUrl', () =>
  {
    const node = useRepoObjectsStore().selected;
    const url = node?.detail ?? node?.title;
    if (url)
    {
      window.open(url, '_blank');
    }
  });

  /**
   * The selected remote branch, split into the remote and the branch inside it. From
   * the node's own `remote` field, not the text before the first slash: a remote called
   * `team/upstream` with a branch `fix` would otherwise misparse as `upstream/fix` on remote `team`.
   */
  function selectedRemoteBranch(): { remote: string; branch: string } | null
  {
    const node = useRepoObjectsStore().selected;
    if (node?.kind !== KIND_REMOTE_BRANCH || !node.ref || !node.remote)
    {
      return null;
    }
    return { remote: node.remote, branch: node.ref.slice(node.remote.length + 1) };
  }

  /**
   * Fetch this one branch: the refspec names it, so git updates that tracking ref
   * alone. The `+` force marker the pull dialog uses is absent: that's for fetching into a named local branch, and there's none here.
   */
  async function fetchSelectedBranch(): Promise<boolean>
  {
    const parts = selectedRemoteBranch();
    if (!parts)
    {
      return false;
    }
    return fetchNow(buildFetchBranchArgs(parts), {
      remoteName: parts.remote,
      ref: parts.branch
    });
  }

  implementCommand('remoteBranch.fetch', () => fetchSelectedBranch());

  /**
   * The four *fetch and then something* rows: fetch and checkout, merge, rebase, or
   * create a branch. Two operations, not one: a failed fetch stops and never acts on
   * what an older fetch left behind. `selectedRef` is read before the fetch, since the
   * panel's selection may not survive the reload.
   */
  function fetchThen(open: (ref: string) => void)
  {
    return async (): Promise<void> =>
    {
      const ref = selectedRef();
      if (!ref)
      {
        return;
      }
      if (await fetchSelectedBranch())
      {
        open(ref);
      }
    };
  }

  // The dialog, always: a remote branch has the create/reset question to answer, and skipping it is a detached HEAD nobody asked for.
  implementCommand(
    'remoteBranch.fetchCheckout',
    fetchThen((ref) => useUiStore().openDialog('branch.checkout', { ref }))
  );

  // `fetch` then `merge`, not `pull`: the merge dialog offers `--no-ff`, strategy and message, which plain `pull` has none of.
  implementCommand(
    'remoteBranch.pull',
    fetchThen((ref) => useUiStore().openDialog('branch.merge', { ref }))
  );

  implementCommand(
    'remoteBranch.fetchRebase',
    fetchThen((ref) => useUiStore().openDialog('branch.rebase', { ref }))
  );

  implementCommand(
    'remoteBranch.fetchCreateBranch',
    fetchThen((ref) => useUiStore().openDialog('branch.create', { ref }))
  );

  // A dialog, not `window.confirm`: deleting a remote branch is a push, and the local branch left tracking it is easy to forget.
  implementCommand('remoteBranch.delete', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('branch.deleteRemote', { ref });
  });

  implementCommand('tag.push', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('remote.push', { tagName: ref });
  });

  implementCommand('stash.open', () =>
  {
    const node = useRepoObjectsStore().selected;
    if (!node?.sha)
    {
      return;
    }
    useSelectionStore().select(node.sha);
  });

  // The same window for all three, differing only in what it opens selected. "Manage" is the list.
  implementCommand('stash.save', () => useUiStore().openDialog('stash'));
  implementCommand('stash.manage', () => useUiStore().openDialog('stash.manage'));

  /**
   * Compare the selected ref against the branch you're on: the panel's version of
   * `compare.withCurrent`, with a ref as the operand instead of a row's commit. The ref is the *base*.
   */
  implementCommand('ref.compareToCurrent', () =>
  {
    const ref = selectedRef();
    if (!ref)
    {
      return;
    }
    useUiStore().openDialog('compare', { compareBase: ref, compareTo: HEAD_REF });
  });

  // ── Submodules ──────────────────────────────────────────────────────────────
  /** A submodule is a repository, so "open" is `repo.open` on its path (resolved to absolute, unlike `.gitmodules`'s relative one). */
  implementCommand('submodule.open', async () =>
  {
    const path = selectedPath();
    if (path)
    {
      await useRepoStore().open(path);
    }
  });

  implementCommand('submodule.openInNewWindow', async () =>
  {
    const path = selectedPath();
    // A window of its own: reading a submodule *beside* its superproject is why this row exists separately.
    if (path)
    {
      await api['repo:openWindow'](path);
    }
  });

  // The four that act on one submodule open the list with it selected, where the command is shown before it runs.
  const openSubmodules = () =>
  {
    useUiStore().openDialog('submodule.manage', { filePath: selectedPath() });
  };
  implementCommand('submodule.update', openSubmodules);
  implementCommand('submodule.manage', () => useUiStore().openDialog('submodule.manage'));

  /**
   * Working *inside* a submodule is done in the submodule: it has windows of its own
   * for resetting, stashing, committing. So the row opens it and names the dialog,
   * rather than running `git -C <path>` whose output belongs off screen.
   */
  const openSubmoduleFor = (what: string) => async () =>
  {
    const path = selectedPath();
    if (!path)
    {
      return;
    }
    const ui = useUiStore();
    if (await useRepoStore().open(path))
    {
      ui.toast(`Opened the submodule: ${what} from here.`);
    }
  };
  implementCommand('submodule.reset', openSubmoduleFor('reset its changes'));
  implementCommand('submodule.stash', openSubmoduleFor('stash its changes'));
  implementCommand('submodule.commit', openSubmoduleFor('commit'));

  // The two that act on every submodule at once open the list on its "All submodules" row.
  implementCommand('submodule.sync', () => useUiStore().openDialog('submodule.manage'));
  implementCommand('submodule.updateAll', () => useUiStore().openDialog('submodule.manage'));

  // ── Worktrees ───────────────────────────────────────────────────────────────
  implementCommand('worktree.create', () =>
  {
    // The panel's selected ref, when there is one: creating from the branch you right-clicked opens on it.
    useUiStore().openDialog('worktree.create', { ref: selectedRef() });
  });

  /**
   * Open the worktree the panel has selected, in this window. A worktree *is* a
   * repository here (own working directory, own HEAD, same object store), so it's `repo.open`.
   */
  implementCommand('worktree.open', async () =>
  {
    const path = selectedPath();
    if (path)
    {
      await useRepoStore().open(path);
    }
  });

  implementCommand('worktree.delete', () =>
  {
    useUiStore().openDialog('worktree.manage', { filePath: selectedPath() });
  });

  // Pruning has nothing to confirm about a selection, so it opens the list, where what would be forgotten previews first.
  implementCommand('worktree.prune', () => useUiStore().openDialog('worktree.manage'));
  implementCommand('worktree.manage', () => useUiStore().openDialog('worktree.manage'));
}
