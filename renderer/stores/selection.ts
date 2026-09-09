/**
 * What is selected in the revision grid. Keyed by SHA, not row index: the `.git`
 * watcher reloads the log on any change, and a commit's row moves whenever something
 * lands above it. `picks` holds the selected SHAs oldest-first; click order is data,
 * not a rendering detail, since two-commit commands read meaning from *which* commit
 * was clicked second. Imports nothing but pinia, vue and one pure helper, which keeps
 * anchored range extension a plain unit test.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { indexRange } from '@renderer/model/indexRange.js';

/** The grid rows this store needs to know about: their order, and their SHAs. */
export type SelectableRow = { readonly sha: string };

export const useSelectionStore = defineStore('selection', () =>
{
  /** Selected SHAs in pick order, oldest pick first. See the module comment. */
  const picks = ref<string[]>([]);

  /** Membership only. Never iterate it: iterate `ordered` or `inDisplayOrder`. */
  const selected = computed(() => new Set(picks.value));

  /** Where a shift-click measures from. Moves only on a plain click or a toggle. */
  const anchor = ref<string | null>(null);

  /** The selection most-recently-picked first, the order two-commit commands index into. */
  const ordered = computed(() => [...picks.value].reverse());

  /** The commit the details pane describes: the last one clicked, not the first of the set. */
  const primary = computed<string | null>(() => ordered.value[0] ?? null);

  const count = computed(() => picks.value.length);
  const isEmpty = computed(() => picks.value.length === 0);

  function has(sha: string): boolean
  {
    return selected.value.has(sha);
  }

  /** The selection top-down as the grid draws it, for commands wanting a range rather than two endpoints. `rows` is read, never kept. */
  function inDisplayOrder(rows: readonly SelectableRow[]): string[]
  {
    const chosen = selected.value;
    return rows.filter((r) => chosen.has(r.sha)).map((r) => r.sha);
  }

  /** Plain click: this commit alone. */
  function select(sha: string): void
  {
    picks.value = [sha];
    anchor.value = sha;
  }

  /** Ctrl/Cmd-click: add or remove one commit, leaving the rest alone. */
  function toggle(sha: string): void
  {
    // Deselecting drops it from the pick order, leaving whatever was picked before it as the primary.
    if (has(sha))
    {
      picks.value = picks.value.filter((s) => s !== sha);
    }
    else
    {
      picks.value = [...picks.value, sha];
    }
    anchor.value = sha;
  }

  /**
   * Shift-click: everything between the anchor and `sha` inclusive. `rows` is the
   * grid's display order, read never kept. Walked *from the anchor towards `sha`*, so
   * the end dragged to becomes `primary` regardless of drag direction.
   */
  function extendTo(sha: string, rows: readonly SelectableRow[]): void
  {
    let from;
    if (anchor.value === null)
    {
      from = -1;
    }
    else
    {
      from = rows.findIndex((r) => r.sha === anchor.value);
    }
    const to = rows.findIndex((r) => r.sha === sha);
    if (to === -1)
    {
      return;
    }

    // No anchor, or one scrolled out of the loaded history: behaves as a plain click and sets one.
    if (from === -1)
    {
      select(sha);
      return;
    }

    picks.value = indexRange(from, to).map((i) => rows[i]!.sha);
  }

  function clear(): void
  {
    picks.value = [];
    anchor.value = null;
  }

  /**
   * Drop anything no longer in the log, after a reload or filter change, rather than
   * clearing on reload. Pick order among survivors is preserved, so `primary` only moves when the commit it pointed at is really gone.
   */
  function retain(rows: readonly SelectableRow[]): void
  {
    if (picks.value.length === 0)
    {
      return;
    }

    const live = new Set(rows.map((r) => r.sha));
    const next = picks.value.filter((sha) => live.has(sha));
    if (next.length === picks.value.length)
    {
      return;
    }

    picks.value = next;
    if (anchor.value !== null && !live.has(anchor.value))
    {
      anchor.value = primary.value;
    }
  }

  return {
    picks,
    selected,
    ordered,
    primary,
    anchor,
    count,
    isEmpty,
    has,
    inDisplayOrder,
    select,
    toggle,
    extendTo,
    clear,
    retain
  };
});
