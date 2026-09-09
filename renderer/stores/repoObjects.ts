/**
 * Repository objects for the left panel: branches, remotes, tags, stashes, submodules, worktrees.
 * Composition root: fans out five independent reads together, owns merged state and tree state.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  REF_KIND_BRANCH,
  type RefEntry,
  type RemoteEntry,
  type StashEntry,
  type SubmoduleEntry,
  type WorktreeEntry
} from '@shared/types.js';
import { api, toMessage } from '@renderer/api.js';
import { isArtificialSha } from '@shared/artificial.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { createMergedState } from './repoObjects/merged.js';
import { createTreeState } from './repoObjects/tree.js';

export const useRepoObjectsStore = defineStore('repoObjects', () =>
{
  const refs = ref<RefEntry[]>([]);
  const remotes = ref<RemoteEntry[]>([]);
  const stashes = ref<StashEntry[]>([]);
  const submodules = ref<SubmoduleEntry[]>([]);
  const worktrees = ref<WorktreeEntry[]>([]);

  const loading = ref(false);
  const error = ref<string | null>(null);

  const settings = useSettingsStore();
  const repo = useRepoStore();
  const selection = useSelectionStore();

  const merged = createMergedState({ repo, refs: () => refs.value });
  const tree = createTreeState({
    settings,
    objects: () => ({
      refs: refs.value,
      remotes: remotes.value,
      stashes: stashes.value,
      submodules: submodules.value,
      worktrees: worktrees.value,
      repoPath: repo.repo?.path ?? '',
      mergedRefs: merged.mergedRefs.value
    })
  });

  function currentBranchOf(list: readonly RefEntry[]): string | null
  {
    return list.find((entry) => entry.kind === REF_KIND_BRANCH && entry.isCurrent)?.name ?? null;
  }

  /** Where every ref points, as one comparable string: what "a ref moved" means. */
  function refTargetsOf(list: readonly RefEntry[]): string
  {
    return list.map((entry) => `${entry.fullName}:${entry.sha}`).join('\n');
  }

  /**
   * Load everything for a repository. Replace all lists together (not cleared first) to avoid blinking.
   */
  async function load(repoPath: string): Promise<void>
  {
    loading.value = true;
    error.value = null;
    try
    {
      const [nextRefs, nextRemotes, nextStashes, nextSubmodules, nextWorktrees] =
        await Promise.all([
          api['refs:list'](repoPath),
          api['remote:list'](repoPath),
          api['stash:list'](repoPath),
          api['submodule:list'](repoPath),
          api['worktree:list'](repoPath)
        ]);

      const previousRefs = refs.value;
      const wasOn = currentBranchOf(previousRefs);

      refs.value = nextRefs;
      remotes.value = nextRemotes;
      stashes.value = nextStashes;
      submodules.value = nextSubmodules;
      worktrees.value = nextWorktrees;

      // Whether the panel's selection follows is the difference between "the branch
      // changed" and "the lists were re-read", and the two ref lists are the only place
      // that can tell them apart. A checkout is a move you asked for, so the selection
      // goes with it; a watcher tick, an F5, or a commit on the branch you are already on
      // moves nothing and must leave the selection where you put it. Reading it off the
      // refs rather than off a facet also covers a checkout run in a terminal, which
      // reaches this window as "everything changed" and nothing more specific.
      const nowOn = currentBranchOf(nextRefs);
      if (nowOn && nowOn !== wasOn)
      {
        tree.selectCurrentBranch();
      }
      else
      {
        tree.revealCurrentBranch();
      }

      // The set was computed against the previous ref list, so a ref that moved makes it
      // stale. Only then: `load()` also runs for a checkout, which moves HEAD and no ref
      // at all, and invalidating there costs a `for-each-ref --merged` walk of the whole
      // history to arrive at the answer already held.
      if (refTargetsOf(nextRefs) !== refTargetsOf(previousRefs))
      {
        merged.invalidate();
      }
      // Against whatever the grid has selected, or HEAD when it has nothing yet, which
      // is the state on open, and the question worth answering there: what is already
      // contained in the branch I am on.
      const sha = selection.primary;
      if (sha === null || isArtificialSha(sha))
      {
        merged.loadMerged(null);
      }
      else
      {
        merged.loadMerged(sha);
      }
    }
    catch (err)
    {
      // A read that fails silently leaves an empty panel that looks like an empty
      // repository. Say so instead.
      error.value = toMessage(err);
    }
    finally
    {
      loading.value = false;
    }
  }

  function reset(): void
  {
    merged.reset();
    refs.value = [];
    remotes.value = [];
    stashes.value = [];
    submodules.value = [];
    worktrees.value = [];
    tree.reset();
    error.value = null;
  }

  return {
    refs,
    remotes,
    stashes,
    submodules,
    worktrees,
    loading,
    error,
    expanded: tree.expanded,
    selectedId: tree.selectedId,
    filter: tree.filter,
    sections: tree.sections,
    sort: tree.sort,
    ascending: tree.ascending,
    tree: tree.tree,
    visibleTree: tree.visibleTree,
    rows: tree.rows,
    selected: tree.selected,
    load,
    reset,
    select: tree.select,
    revealCurrentBranch: tree.revealCurrentBranch,
    mergedRefs: merged.mergedRefs,
    loadMerged: merged.loadMerged,
    isExpanded: tree.isExpanded,
    toggleExpanded: tree.toggleExpanded,
    setExpanded: tree.setExpanded,
    expandAll: tree.expandAll,
    collapseAll: tree.collapseAll,
    moveSectionBy: tree.moveSectionBy,
    setSortOrder: tree.setSortOrder
  };
});
