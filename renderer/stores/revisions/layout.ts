/**
 * The graph layout, and what the grid dims while drawing it: turning `rows` into lanes
 * (`relayout`), and deciding which ancestry is drawn in full colour. Nothing here talks
 * to `api`: `loading.ts` calls `relayout()` when the stream changes shape.
 */

import { computed, ref, shallowRef, type ComputedRef } from 'vue';
import { GRAPH_DIM_NONE, type CommitRow } from '@shared/types.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import type { GraphConfig, GraphRow } from '@renderer/model/graph/index.js';
import { buildGraph, markAncestry } from '@renderer/model/graph/index.js';

/** "Dim nothing": shared, since it is returned on every frame there is no seed. */
const EMPTY_MARKS = new Uint8Array(0);

export interface LayoutDeps {
  repo: ReturnType<typeof useRepoStore>;
  settings: ReturnType<typeof useSettingsStore>;
  rows: ComputedRef<CommitRow[]>;
  rowOf: (sha: string) => number | undefined;
  /**
   * Told how long a layout took and how many rows it was over.
   *
   * Injected, not imported: this module talks to no `api` and reaching for one would end
   * that. The composition root supplies it, the same way `observeCommands` is handed in.
   */
  onRelayout?: (ms: number, rows: number) => void;
}

export function createLayoutState({ repo, settings, rows, rowOf, onRelayout }: LayoutDeps)
{
  const graph = shallowRef<GraphRow[]>([]);

  // ── What the graph draws in colour ──────────────────────────────────────────

  /**
   * The commit "Highlight Selected Branch" pinned the dimming to, or null for none.
   * Deliberately *not* the current selection: a graph whose emphasis moves on every
   * arrow key tells you about the cursor, not the branch you're on. `load()` clears it, which is the whole of what "(until refresh)" promises.
   */
  const highlightSeed = ref<string | null>(null);

  /** The commit whose ancestry is drawn in full colour, or null to dim nothing. The override outranks the setting: a chosen commit wins over dimming everything off the current branch. */
  const relativeSeed = computed<string | null>(() =>
  {
    if (highlightSeed.value !== null)
    {
      return highlightSeed.value;
    }
    if (settings.settings.graphDimNonRelatives === GRAPH_DIM_NONE)
    {
      return null;
    }
    // A detached or unborn HEAD has no branch to lead with, so nothing is dimmed.
    return repo.repo?.head ?? null;
  });

  /**
   * Rows in that ancestry, indexed by row for the canvas to read per frame. Empty means
   * "dim nothing", not the same as an array of zeros, which would dim every lane. A
   * `computed`, so scrolling never recomputes it; the sweep itself is sub-millisecond, so no debouncing is needed even when it changes.
   */
  const relative = computed<Uint8Array>(() =>
  {
    const seed = relativeSeed.value;
    if (seed === null)
    {
      return EMPTY_MARKS;
    }
    const seedRow = rowOf(seed);
    if (seedRow === undefined)
    {
      return EMPTY_MARKS;
    }
    return markAncestry(rows.value, rowOf, seedRow);
  });

  /** The layout setting as a snapshot, read once rather than per row, so `buildGraph` stays a pure function of `(commits, config)`. */
  function graphConfig(): GraphConfig
  {
    return { mergeCommonParentLanes: settings.settings.graphMergeCommonParentLanes };
  }

  /**
   * Recompute the whole layout. Deliberately not incremental: a commit arriving
   * mid-stream can start a line that changes rows already drawn, and a full pass is
   * cheaper than being subtly wrong.
   *
   * `relative` is not an input. Which rows are highlighted is drawn, never laid out:
   * each line carries the row of the commit it descends from and the canvas reads the
   * marks itself, so the seed moving is a redraw and never a relayout.
   */
  function relayout(): void
  {
    const started = performance.now();
    graph.value = buildGraph(rows.value, graphConfig());
    onRelayout?.(performance.now() - started, rows.value.length);
  }

  /** Clear immediately: for closing a repository, where there is nothing to keep. */
  function reset(): void
  {
    graph.value = [];
    highlightSeed.value = null;
  }

  return { graph, highlightSeed, relative, relayout, reset };
}

export type LayoutState = ReturnType<typeof createLayoutState>;
