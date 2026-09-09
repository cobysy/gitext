/**
 * The diff patch and differences in it. Parse once (not three times: viewer, Monaco, aligned).
 */

import { computed, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { alignPatch, parsePatch, type PatchFile } from '@renderer/model/patch.js';
import { newestOnly } from '@renderer/model/newest.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import type { DiffFileEntry, DiffRange } from '@shared/diff.js';
import type { PivotState } from './pivot.js';
import type { SelectionState } from './selection.js';

interface PatchTarget {
  repoPath: string;
  current: DiffRange;
  file: DiffFileEntry;
}

/** The repo/range/file to load a patch for, or null when any is missing. */
function patchTargetOf(
  repoPath: string | undefined,
  current: DiffRange | null,
  file: DiffFileEntry | null
): PatchTarget | null
{
  if (repoPath && current && file)
  {
    return { repoPath, current, file };
  }
  else
  {
    return null;
  }
}

/** What `diff:patch` answers with: one file's unified diff, and whether it was cut short. */
export interface Patch {
  path: string;
  text: string;
  truncated: boolean;
}

/** Two answers nobody could tell apart. See `loadPatch` for why that matters. */
function samePatch(a: Patch | null, b: Patch | null): boolean
{
  if (a === null || b === null)
  {
    return a === b;
  }
  return a.path === b.path && a.text === b.text && a.truncated === b.truncated;
}

export interface PatchDeps {
  repo: ReturnType<typeof useRepoStore>;
  pivot: PivotState;
  selection: SelectionState;
  settings: ReturnType<typeof useSettingsStore>;
}

export function createPatchState({ repo, pivot, selection, settings }: PatchDeps)
{
  const patch = ref<Patch | null>(null);
  const patchLoading = ref(false);
  const patchError = ref<string | null>(null);

  /** Which difference is being looked at; -1 when the file has none. */
  const focusedBlock = ref(-1);

  const parsedFiles = computed<PatchFile[]>(() => parsePatch(patch.value?.text ?? ''));
  const parsedFile = computed<PatchFile | null>(() => parsedFiles.value[0] ?? null);

  /**
   * Patch as rows and differences. In store (not viewer) because commands need to count them.
   */
  const aligned = computed(() => alignPatch(parsedFiles.value, settings.settings.diffViewMode));

  // Land on first difference when patch changes (else scrolling to line 1 loses the edit).
  watch(
    () => patch.value,
    () =>
    {
      if (aligned.value.blocks.length > 0)
      {
        focusedBlock.value = 0;
      }
      else
      {
        focusedBlock.value = -1;
      }
    }
  );

  /** Move to the next or previous difference, stopping at the ends rather than wrapping. */
  function stepDifference(delta: number): void
  {
    const count = aligned.value.blocks.length;
    if (count === 0)
    {
      return;
    }
    focusedBlock.value = Math.min(count - 1, Math.max(0, focusedBlock.value + delta));
  }

  function focusBlock(index: number): void
  {
    if (index >= 0 && index < aligned.value.blocks.length)
    {
      focusedBlock.value = index;
    }
  }

  const patchRequest = newestOnly();

  async function loadPatch(): Promise<void>
  {
    const isNewest = patchRequest.begin();
    const target = patchTargetOf(repo.repo?.path, pivot.range.value, selection.selectedFile.value);

    patchError.value = null;
    if (!target)
    {
      patch.value = null;
      patchLoading.value = false;
      return;
    }

    // Keep patch while fetching next (avoid flashing blank, Monaco rebuilding from scratch).
    patchLoading.value = true;
    try
    {
      const result = await api['diff:patch'](target.repoPath, target.current, target.file, pivot.options.value);
      // Only update if different (avoid re-building Monaco models and losing focus position).
      if (isNewest() && !samePatch(patch.value, result))
      {
        patch.value = result;
      }
    }
    catch (err)
    {
      if (isNewest())
      {
        patchError.value = toMessage(err);
        patch.value = null;
      }
    }
    finally
    {
      if (isNewest())
      {
        patchLoading.value = false;
      }
    }
  }

  function reset(): void
  {
    patch.value = null;
    patchError.value = null;
    focusedBlock.value = -1;
  }

  return {
    patch,
    patchLoading,
    patchError,
    focusedBlock,
    parsedFile,
    aligned,
    stepDifference,
    focusBlock,
    loadPatch,
    reset
  };
}

export type PatchState = ReturnType<typeof createPatchState>;
