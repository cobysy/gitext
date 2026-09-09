/**
 * Revision list and graph layout. Composition root: streams commits in batches (paints first screenful quickly).
 */

import { defineStore } from 'pinia';
import { computed, watch } from 'vue';
import type { CommitRow } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { buildArtificialRows } from '@shared/artificial.js';
import { noteTiming } from '@renderer/diagnostics.js';
import { createStreamState } from './revisions/stream.js';
import { createLayoutState } from './revisions/layout.js';
import { createLoadingState } from './revisions/loading.js';

export const useRevisionsStore = defineStore('revisions', () =>
{
  const settings = useSettingsStore();
  const selection = useSelectionStore();
  const repo = useRepoStore();

  /**
   * The working-tree and index rows, derived rather than fetched.
   *
   * `repo.status` is already read on open and on every watcher tick, so these rows
   * cost no git call of their own and, more importantly, cannot fall out of step
   * with the status the rest of the UI is showing. A bare repository has no working
   * tree, so it never has them.
   */
  const artificialRows = computed<CommitRow[]>(() =>
  {
    if (!settings.settings.showArtificialCommits)
    {
      return [];
    }
    if (repo.repo?.isBare)
    {
      return [];
    }
    return buildArtificialRows(repo.status, repo.repo?.head ?? null);
  });

  const stream = createStreamState({ artificialRows });

  /**
   * What the grid actually draws: the artificial rows, then the commits.
   *
   * One list, so row *n* of the grid, of `graph`, and of a shift-range all mean the
   * same thing. When there are no artificial rows this is `commits` itself rather
   * than a copy of it: the common case on a clean tree, and worth not copying
   * tens of thousands of entries for.
   */
  const rows = computed<CommitRow[]>(() =>
  {
    if (artificialRows.value.length === 0)
    {
      return stream.commits.value;
    }
    else
    {
      return [...artificialRows.value, ...stream.commits.value];
    }
  }
  );

  const layout = createLayoutState({
    repo,
    settings,
    rows,
    rowOf: stream.rowOf,
    // Timed because it is the app's own work over the whole history, and nothing else
    // records it.
    onRelayout: (ms, count) =>
    {
      // Nothing to lay out is not a measurement: an empty graph files a 0ms line on
      // every open, which is noise in the one place noise costs the most.
      if (count > 0)
      {
        noteTiming('graph layout', ms, [`${count} rows`]);
      }
    }
  });
  const loading = createLoadingState({ repo, settings, selection, stream, layout, rows });

  const isTruncated = computed(() => loading.total.value !== null && loading.total.value > stream.count.value);

  /** Clear immediately: for closing a repository, where there is nothing to keep. */
  function reset(): void
  {
    stream.clear();
    layout.reset();
    loading.reset();
    selection.clear();
  }

  // The artificial rows change on their own schedule: staging a file moves one row
  // between them without the log being re-read at all: so the layout has to follow
  // them, not just the commit stream. Cheap: it only fires when the *set* of
  // artificial rows changes, which is at most twice per working-tree transition.
  //
  // The lane-merging setting is watched alongside them because it is an input to the same
  // call: toggling it has to re-lay out, not merely redraw, or the canvas paints a stale
  // graph until the next refresh.
  watch(
    () => [
      artificialRows.value.map((r) => `${r.sha}:${r.parents.join(',')}`).join('|'),
      settings.settings.graphMergeCommonParentLanes
    ],
    () =>
    {
      // Nothing to lay out yet; the first batch will do it.
      //
      // Nor while a reload is on its way: the rows it would lay out are the *old* ones,
      // and the reload clears the graph and lays out again the moment its first batch
      // lands. A refresh reloads the log and re-reads the status, and the status arrives
      // first, so this fired every time: two full layouts of a 17.7k-row history, the
      // first thrown away unseen. It cost about 100ms and nothing could see it until the
      // layout was timed.
      const worthLayingOut =
        !loading.pendingReplace.value
        && (stream.commits.value.length > 0 || artificialRows.value.length > 0);
      if (worthLayingOut)
      {
        layout.relayout();
      }
      // Staging everything removes the working-tree row without the log changing at
      // all, so this is the only place that notices the selection now points at a
      // row that no longer exists.
      selection.retain(rows.value);
    }
  );

  return {
    commits: stream.commits,
    rows,
    artificialRows,
    graph: layout.graph,
    highlightSeed: layout.highlightSeed,
    relative: layout.relative,
    loading: loading.loading,
    error: loading.error,
    total: loading.total,
    options: loading.options,
    pathFilter: loading.pathFilter,
    setPathFilter: loading.setPathFilter,
    effectiveOptions: loading.effectiveOptions,
    count: stream.count,
    isTruncated,
    load: loading.load,
    onBatch: loading.onBatch,
    cancelReveal: loading.cancelReveal,
    cancel: loading.cancel,
    reset,
    rowOf: stream.rowOf,
    commitOf: stream.commitOf,
    childrenOf: stream.childrenOf
  };
});
