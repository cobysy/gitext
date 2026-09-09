/**
 * The patch on screen: what file and side it is of, and reading it from git. One
 * responsibility, the diff pane's content, kept pinned to the file it was read for
 * while the selection moves on ahead of it.
 */

import { computed, ref, watch, type Ref } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import { parsePatch, type PatchFile } from '@renderer/model/patch.js';
import { toFilePath, type FilePath } from '@renderer/model/paths.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import { STAGING_OPTIONS, type StagingSide } from './types.js';
import type { SelectionState } from './selection.js';

/**
 * A picked diff line's key, as `"<hunk>:<line>"`. Branded, not a plain `string`, so a
 * `pickedLines` set can't be handed a raw template string that merely looks like one.
 */
export type LineKey = string & { readonly __brand: 'LineKey' };

/**
 * How a picked diff line is named. Exported: `StagingDiff.vue` writes the set this
 * store reads, and two spellings of the key would silently disagree.
 */
export const lineKey = (hunk: number, line: number): LineKey => `${hunk}:${line}` as LineKey;

export interface PatchStateDeps {
  repo: ReturnType<typeof useRepoStore>;
  settings: ReturnType<typeof useSettingsStore>;
  selection: SelectionState;
  /** Shared with `actions.ts`: one error surface for every read and write on this screen. */
  error: Ref<string | null>;
}

export function createPatchState({ repo, settings, selection, error }: PatchStateDeps)
{
  const patchText = ref('');
  const patchLoading = ref(false);
  const patchTruncated = ref(false);

  /**
   * The file and side `patchText` is a diff of: null until an answer has landed. The
   * text outlives the selection that asked for it, so the pane never blanks between a click and the read landing.
   *
   * This is the operand, not the selection: `applyHunk` builds from this text, and a
   * hunk hotkey mid-read must act on the file on screen, not the next one the selection
   * has already moved to.
   *
   * Two primitives, not one object: a fresh object every reload would recompute
   * `patchFile` and rebuild the pane's rows even when a re-read answers with the same diff.
   */
  const patchPath = ref<FilePath | null>(null);
  const patchSide = ref<StagingSide | null>(null);

  /** The file on screen, and its side: the operand of everything that acts on a hunk. */
  const patchTarget = computed<{ path: FilePath; side: StagingSide } | null>(() =>
  {
    const path = patchPath.value;
    const which = patchSide.value;
    if (path === null || which === null)
    {
      return null;
    }
    return { path, side: which };
  });

  /**
   * Which hunk the diff pane is on, for the commands that act on "this hunk".
   *
   * Here rather than in the component for the same reason the diff store keeps
   * `focusedBlock`: "reset chunk" is a command like any other, and a command must not
   * reach into a component to find out which hunk is meant.
   */
  const focusedHunk = ref(0);

  /**
   * The diff lines the user has picked, as `lineKey` keys. In the store, not the
   * component: staging a selection is a registry command, and a command must not reach into a component.
   */
  const pickedLines = ref(new Set<LineKey>());

  /**
   * The patch in hand, parsed: the one that *landed*, not the one the selection is
   * waiting for (see `patchTarget`). Everything reading a hunk reads it through here.
   */
  const patchFile = computed<PatchFile | null>(() =>
  {
    if (patchPath.value === null)
    {
      return null;
    }
    return parsePatch(patchText.value)[0] ?? null;
  });

  /** The text of the picked diff lines, in order, without their markers. */
  const pickedLineText = computed<string>(() =>
  {
    const file = patchFile.value;
    if (!file || pickedLines.value.size === 0)
    {
      return '';
    }
    const lines: string[] = [];
    file.hunks.forEach((hunk, hunkIndex) =>
    {
      hunk.lines.forEach((line, lineIndex) =>
      {
        if (pickedLines.value.has(lineKey(hunkIndex, lineIndex)))
        {
          lines.push(line.text);
        }
      });
    });
    return lines.join('\n');
  });

  const patchRequest = newestOnly();

  async function loadPatch(): Promise<void>
  {
    const isNewest = patchRequest.begin();
    const repoPath = repo.repo?.path;
    const file = selection.selectedFile.value;
    const from = selection.side.value;
    if (!repoPath || !file)
    {
      patchText.value = '';
      patchTruncated.value = false;
      patchPath.value = null;
      patchSide.value = null;
      return;
    }

    patchLoading.value = true;
    try
    {
      const result = await api['diff:patch'](repoPath, selection.sides[from].range, file, {
        ...STAGING_OPTIONS,
        contextLines: settings.settings.diffContextLines
      });
      if (!isNewest())
      {
        return;
      }
      patchText.value = result.text;
      patchTruncated.value = result.truncated;
      patchPath.value = toFilePath(file.path);
      patchSide.value = from;
    }
    catch (err)
    {
      if (!isNewest())
      {
        return;
      }
      error.value = toMessage(err);
      patchText.value = '';
      patchPath.value = null;
      patchSide.value = null;
    }
    finally
    {
      if (isNewest())
      {
        patchLoading.value = false;
      }
    }
  }

  /**
   * The patch follows the selection, both file and side. Without this, clicking a row
   * only moved a highlight, and selecting a half-staged file's staged copy could show the
   * unstaged diff with an "Unstage" button that reverse-applies the wrong side.
   */
  watch([selection.side, selection.selectedPath], () => void loadPatch());

  /**
   * A hunk index means nothing once the drawn patch is another file's: `file.resetChunk`
   * acts on `patchFile.hunks[focusedHunk]`, last set by the *previous* file's click. Keyed
   * on the drawn patch, so a re-read of the same file and side leaves it untouched.
   */
  watch(patchTarget, () =>
  {
    focusedHunk.value = 0;
  });

  function reset(): void
  {
    patchText.value = '';
    patchTruncated.value = false;
    patchPath.value = null;
    patchSide.value = null;
  }

  return {
    patchText,
    patchLoading,
    patchTruncated,
    patchTarget,
    patchFile,
    focusedHunk,
    pickedLines,
    pickedLineText,
    loadPatch,
    reset
  };
}

export type PatchState = ReturnType<typeof createPatchState>;
