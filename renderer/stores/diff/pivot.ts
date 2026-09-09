/**
 * Diff pivot: what range is compared and what flags shape the read.
 * Turns grid selection and settings into DiffRange/DiffOptions and identity strings (rangeKey, requestKey) to watch.
 */

import { computed, ref } from 'vue';
import {
  ENDPOINT_KIND_COMMIT,
  rangeForSelection,
  WHOLE_FILE_CONTEXT,
  type DiffOptions,
  type DiffRange
} from '@shared/diff.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useRevisionsStore } from '@renderer/stores/revisions.js';
import type { useSelectionStore } from '@renderer/stores/selection.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';

const ROOT_KEY = 'root';

export interface PivotDeps {
  repo: ReturnType<typeof useRepoStore>;
  revisions: ReturnType<typeof useRevisionsStore>;
  /** The revision grid's own selection: this store's pivot is a reading of it. */
  gridSelection: ReturnType<typeof useSelectionStore>;
  settings: ReturnType<typeof useSettingsStore>;
}

export function createPivotState({ repo, revisions, gridSelection, settings }: PivotDeps)
{
  /**
   * The pivot the grid's selection implies. Derived, never assigned: a second copy of it
   * here would be one more thing to keep in step with the selection that produced it.
   */
  const selectionRange = computed<DiffRange | null>(() =>
    rangeForSelection(gridSelection.picks, (sha) => revisions.commitOf(sha)?.parents[0] ?? null)
  );

  /**
   * Range a window was told to show (dialogs without a grid). Per-window only: repo has selectionRange, dialogs have this.
   */
  const assignedRange = ref<DiffRange | null>(null);

  function setRange(next: DiffRange | null): void
  {
    assignedRange.value = next;
  }

  const range = computed<DiffRange | null>(() => assignedRange.value ?? selectionRange.value);

  /** The whitespace and context settings, as `git diff` flags. */
  const options = computed<DiffOptions>(() =>
  {
    let contextLines: number;
    if (settings.settings.diffWholeFile)
    {
      contextLines = WHOLE_FILE_CONTEXT;
    }
    else
    {
      contextLines = settings.settings.diffContextLines;
    }
    return {
      ignoreWhitespace: settings.settings.diffIgnoreWhitespace,
      contextLines,
      // Always carried so list reloads when toggle moves (only used when pivot touches working tree).
      includeIgnored: settings.settings.fileListShowIgnored
    };
  });

  /**
   * Range as a string to compare (fresh object on each selection change would reload the list too often).
   */
  const rangeKey = computed(() =>
  {
    const current = range.value;
    if (!current)
    {
      return '';
    }
    const side = (endpoint: DiffRange['from']): string =>
    {
      if (endpoint === null)
      {
        return ROOT_KEY;
      }
      switch (endpoint.kind)
      {
        case ENDPOINT_KIND_COMMIT:
          return endpoint.sha;
        default:
          return endpoint.kind;
      }
    };
    return `${side(current.from)}..${side(current.to)}`;
  });

  /** Everything a read depends on, as one string: the file list reloads when it changes. */
  const requestKey = computed(
    () => `${repo.repo?.path ?? ''} ${rangeKey.value} ${JSON.stringify(options.value)}`
  );

  // assignedRange not returned: nothing outside needs to know if range was assigned.
  return { range, options, rangeKey, requestKey, setRange };
}

export type PivotState = ReturnType<typeof createPivotState>;
