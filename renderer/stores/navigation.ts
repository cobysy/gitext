/**
 * Browser history over commit selection. Entries are SHAs (rows move when log reloads).
 * Pure logic: unit-testable cursor arithmetic, no store dependencies.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * How far back the trail goes. Long enough that nothing a person did this session is
 * lost, short enough that it cannot grow without bound in a window left open for days.
 */
const LIMIT = 100;

export const useNavigationStore = defineStore('navigation', () =>
{
  /** Visited SHAs, oldest first. Everything after `cursor` is the forward trail. */
  const entries = ref<string[]>([]);
  const cursor = ref(-1);

  const current = computed<string | null>(() => entries.value[cursor.value] ?? null);
  const canGoBack = computed(() => cursor.value > 0);
  const canGoForward = computed(() => cursor.value >= 0 && cursor.value < entries.value.length - 1);

  /**
   * Record a visit, discarding any forward trail: the browser rule.
   *
   * Re-visiting whatever is already current is ignored, and that is what keeps
   * `back()` from recording its own destination: back moves the cursor, the selection
   * follows, the watcher calls `visit` with the SHA now under the cursor, and nothing
   * happens. No suppression flag, which would have to survive Vue's async watchers to
   * work at all.
   */
  function visit(sha: string | null): void
  {
    if (sha === null || sha === current.value)
    {
      return;
    }

    const next = [...entries.value.slice(0, cursor.value + 1), sha];
    if (next.length > LIMIT)
    {
      entries.value = next.slice(next.length - LIMIT);
    }
    else
    {
      entries.value = next;
    }
    cursor.value = entries.value.length - 1;
  }

  /** The previous commit, or null when the trail starts here. */
  function back(): string | null
  {
    if (!canGoBack.value)
    {
      return null;
    }
    cursor.value -= 1;
    return current.value;
  }

  function forward(): string | null
  {
    if (!canGoForward.value)
    {
      return null;
    }
    cursor.value += 1;
    return current.value;
  }

  /** Closing or switching repository: the trail does not carry over. */
  function reset(): void
  {
    entries.value = [];
    cursor.value = -1;
  }

  return { entries, cursor, current, canGoBack, canGoForward, visit, back, forward, reset };
});
