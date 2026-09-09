/**
 * Repository invalidation wired to stores. Two callers: event:repoChanged and view.refresh (F5 re-reads all).
 */

import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { ALL_FACETS, type RepoFacet } from '@shared/invalidation.js';
import { applyInvalidation, headMoved, needsLogReload } from './useRepoInvalidation.js';
import { useRevealCommit } from './useRevealCommit.js';

/**
 * Reload only what these facets invalidated.
 *
 * Ordered cheapest-and-most-visible first: the status is what moves the grid's HEAD ring
 * and its artificial rows, so it goes ahead of the log stream that may not be needed at
 * all.
 */
export function invalidateRepository(facets: readonly RepoFacet[]): void
{
  const repo = useRepoStore();
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }

  const settings = useSettingsStore();

  /**
   * The store refresh, for the two branches below that need the HEAD it read.
   *
   * Replaced whenever the handler runs, which is whenever `head` is among the facets, and
   * so whenever `headMoved` is true: the branches below that read the fresh HEAD off the
   * store are exactly the ones that wait on a real refresh. Asking `repo:info` a second
   * time instead cost six git subprocesses per reload, the whole of what that channel is.
   */
  let refreshed = Promise.resolve();

  applyInvalidation(facets, [
    {
      facets: ['head', 'refs', 'worktree', 'index'],
      run: () =>
      {
        refreshed = repo.refresh();
      }
    },
    {
      // The panel's refs, stashes, remotes, worktrees and submodules: one read for all
      // five (`repoObjects.load`). `config` is here because a remote *is* git config.
      //
      // `head` is here because which branch the panel marks as current is a property of
      // the *ref list*, `RefEntry.isCurrent`, filled in by `git for-each-ref`, not of
      // the repo store. Without it a checkout moves HEAD and the grid's ring but leaves the
      // panel bold on a branch it is no longer on.
      facets: ['head', 'refs', 'stashes', 'remotes', 'submodules', 'worktrees', 'config'],
      run: () => void useRepoObjectsStore().load(path)
    },
    {
      // Staging a file moves it between the two lists and editing one changes the patch
      // under it; neither touches the pivot, so the store's own watcher would not fire.
      facets: ['worktree', 'index'],
      run: () => void useDiffStore().refresh()
    },
    {
      // Already a no-op unless the pane is in tree mode.
      facets: ['worktree'],
      run: () => void useFileTreeStore().refresh()
    }
  ]);

  const reload = needsLogReload(facets, {
    branchScope: settings.settings.branchScope,
    reflog: settings.settings.logShowReflog
  });
  const follow = headMoved(facets);

  if (reload && follow)
  {
    // Behind the refresh, not beside it: the reload has to be handed the HEAD the
    // repository moved *to*, and the store is where that arrives.
    void refreshed.then(() =>
      useRevisionsStore().load(path, undefined, { revealHead: repo.repo?.head ?? undefined })
    );
  }
  else if (reload)
  {
    void useRevisionsStore().load(path);
  }
  else if (follow)
  {
    // HEAD moved and the rows did not: a checkout under any scope but `current`, which is
    // most of them. The grid already has the commit drawn, so nothing needs re-reading and
    // the selection is the only thing left behind, sitting on whatever was being looked at
    // before on a branch that may be a thousand rows away.
    void refreshed.then(() => useRevealCommit().reveal(repo.repo?.head, { quiet: true }));
  }
}

/** Re-read everything: what F5 means, and what the `.git` watcher can only ask for. */
export function refreshRepository(): void
{
  invalidateRepository(ALL_FACETS);
}
