/**
 * Quick search in revision grid. Matching logic in gridnav.ts (pure, unit-tested).
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { findQuickSearchMatch, type SearchDirection } from '@renderer/gridnav.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

export const useQuickSearchStore = defineStore('quickSearch', () =>
{
  /** What the overlay shows. Cleared by the timeout; empty means "not searching". */
  const term = ref('');

  /**
   * The last term searched for, kept after the overlay has gone.
   *
   * Quick-search-next has to know what to look for, and expecting the term to still be
   * on screen would make the command useless a second after typing it.
   */
  const lastTerm = ref('');

  /** False when the term matches nothing, which the overlay says in red. */
  const found = ref(true);

  const active = computed(() => term.value.length > 0);

  let timer: ReturnType<typeof setTimeout> | undefined;

  function restartTimer(): void
  {
    if (timer !== undefined)
    {
      clearTimeout(timer);
    }
    timer = setTimeout(() =>
    {
      timer = undefined;
      // Only the display is dropped: `lastTerm` survives so the next/previous commands
      // still have something to repeat.
      term.value = '';
    }, useSettingsStore().settings.quickSearchTimeout);
  }

  /**
   * Search for `next` starting `offset` rows from the selection.
   *
   * `offset` is 0 while typing: refining a term should be able to keep the row it is
   * already on, and ±1 when walking results, which is what makes repeated
   * next/previous move rather than sit on the same match.
   */
  function run(next: string, offset: number, direction: SearchDirection): void
  {
    const revisions = useRevisionsStore();
    const selection = useSelectionStore();

    term.value = next;
    lastTerm.value = next;
    restartTimer();

    const rows = revisions.rows;
    if (rows.length === 0)
    {
      return;
    }

    let baseRow: number;
    if (selection.primary === null)
    {
      baseRow = 0;
    }
    else
    {
      baseRow = revisions.rowOf(selection.primary) ?? 0;
    }
    const from = baseRow + offset;
    const match = findQuickSearchMatch(rows, next, from, direction);
    found.value = match !== undefined;
    if (match !== undefined)
    {
      selection.select(rows[match]!.sha);
    }
  }

  /** A printable character typed with the grid focused. */
  function type(char: string): void
  {
    run(term.value + char.toLowerCase(), 0, 1);
  }

  /**
   * Backspace shortens the term.
   *
   * A one-character term is left alone rather than emptied, so backspace never quietly
   * ends the search: Escape is how you do that, and it says so.
   */
  function backspace(): void
  {
    if (term.value.length <= 1)
    {
      return;
    }
    run(term.value.slice(0, -1), 0, 1);
  }

  /** Quick-search next (down) or previous (up), on the last term searched for. */
  function repeat(direction: SearchDirection): void
  {
    if (lastTerm.value === '')
    {
      return;
    }
    run(lastTerm.value, direction, direction);
  }

  function clear(): void
  {
    if (timer !== undefined)
    {
      clearTimeout(timer);
    }
    timer = undefined;
    term.value = '';
    found.value = true;
  }

  /** Switching repository: the term on screen means nothing in the new history. */
  function reset(): void
  {
    clear();
    lastTerm.value = '';
  }

  return { term, lastTerm, found, active, type, backspace, repeat, clear, reset };
});
