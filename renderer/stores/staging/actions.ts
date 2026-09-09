/**
 * Everything that talks to git for the commit screen: reading the lists and index
 * flags, and every command that changes the index. `selection.ts` and `patch.ts` own
 * the state this writes into; this module owns when a read happens and what a write
 * sends, and every staging action ends in `refresh()` so nothing here can forget to reload.
 */

import { ref, type Ref } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { ConsoleFailure, runConsoleSteps } from '@renderer/gitConsole.js';
import { newestOnly } from '@renderer/model/newest.js';
import { buildHunkPatch, type StageDirection } from '@renderer/model/stagePatch.js';
import { toFilePaths, type FilePath } from '@renderer/model/paths.js';
import type { PatchFile, PatchHunk } from '@renderer/model/patch.js';
import { PATH_SEPARATOR, type DiffFileEntry } from '@shared/diff.js';
import { STAGING, WORKING_TREE, type RepoFacet } from '@shared/invalidation.js';
import { FILE_STATUS_UNCHANGED, OBJECT_KIND_BLOB } from '@shared/types.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import {
  STAGED_RANGE,
  STAGING_OPTIONS,
  STAGING_SIDE_STAGED,
  UNSTAGED_RANGE,
  type StagingSide
} from './types.js';
import type { SelectionState } from './selection.js';
import type { PatchState } from './patch.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const CMD_ADD = 'add';
const CMD_RESET = 'reset';
const CMD_CHECKOUT = 'checkout';
const FLAG_ALL = '-A';
const DIRECTION_STAGE = 'stage';
const DIRECTION_UNSTAGE = 'unstage';

export interface StagingActionsDeps {
  repo: ReturnType<typeof useRepoStore>;
  settings: ReturnType<typeof useSettingsStore>;
  selection: SelectionState;
  patch: PatchState;
  /** Shared with `patch.ts`: one error surface for every read and write on this screen. */
  error: Ref<string | null>;
  /** Everything else's `reset()`, for the "no repository open" branch of `loadFiles`. */
  resetForNoRepo: () => void;
}

interface HunkTarget {
  repoPath: string;
  target: { path: FilePath; side: StagingSide };
  file: PatchFile;
  hunk: PatchHunk;
}

/** The repo/side/file/hunk to stage or unstage, or null when any is missing. */
function hunkTargetOf(
  repoPath: string | undefined,
  target: { path: FilePath; side: StagingSide } | null,
  file: PatchFile | null,
  hunk: PatchHunk | undefined
): HunkTarget | null
{
  if (repoPath && target && file && hunk)
  {
    return { repoPath, target, file, hunk };
  }
  else
  {
    return null;
  }
}

export function createStagingActions({
  repo,
  settings,
  selection,
  patch,
  error,
  resetForNoRepo
}: StagingActionsDeps)
{
  const loading = ref(false);

  /** git's own words from the last failure: see the `catch` in `run`. */
  const failureOutput = ref('');

  /**
   * Paths carrying the two `update-index` flags. Loaded separately from the file
   * lists because they're a property of the index, not of a diff: a skip-worktree file
   * is by construction absent from every diff and status.
   */
  const skipWorktree = ref<FilePath[]>([]);
  const assumeUnchanged = ref<FilePath[]>([]);

  const filesRequest = newestOnly();

  /**
   * Add the files git has been told to pretend are unchanged, when asked to show them.
   * They appear in no diff and no status by construction, so this is the only listing they can be turned back on in.
   */
  function withFlagged(entries: DiffFileEntry[]): DiffFileEntry[]
  {
    const wanted: FilePath[] = [];
    if (settings.settings.stagingShowSkipWorktree)
    {
      wanted.push(...skipWorktree.value);
    }
    if (settings.settings.stagingShowAssumeUnchanged)
    {
      wanted.push(...assumeUnchanged.value);
    }
    if (wanted.length === 0)
    {
      return entries;
    }

    const known = new Set(entries.map((entry) => entry.path));
    const extra = [...new Set(wanted)]
      .filter((path) => !known.has(path))
      // `unchanged`: the flag is a promise the file hasn't changed, and no parser produces this status otherwise.
      .map((path) => ({
        path,
        status: FILE_STATUS_UNCHANGED,
        score: 0,
        kind: OBJECT_KIND_BLOB,
        mode: '',
        binary: false
      }));
    return [...entries, ...extra];
  }

  /**
   * Read both lists. `flags` is an index-flag read, run alongside rather than before the
   * list reads, that must finish before `withFlagged` folds it in; defaults to nothing to wait for.
   */
  async function loadFiles(flags: Promise<void> = Promise.resolve()): Promise<void>
  {
    const isNewest = filesRequest.begin();
    const repoPath = repo.repo?.path;
    if (!repoPath)
    {
      resetForNoRepo();
      return;
    }

    loading.value = true;
    error.value = null;
    try
    {
      const [[unstaged, staged]] = await Promise.all([
        Promise.all([
          api['diff:files'](repoPath, UNSTAGED_RANGE, {
            ...STAGING_OPTIONS,
            includeUntracked: settings.settings.stagingShowUntracked,
            includeIgnored: settings.settings.stagingShowIgnored
          }),
          // The staged list is the index; untracked and ignored files are by definition not in it, so neither option applies here.
          api['diff:files'](repoPath, STAGED_RANGE, STAGING_OPTIONS)
        ]),
        flags
      ]);
      if (!isNewest())
      {
        return;
      }
      selection.unstagedFiles.value = withFlagged(unstaged);
      selection.stagedFiles.value = staged;
    }
    catch (err)
    {
      if (!isNewest())
      {
        return;
      }
      error.value = toMessage(err);
    }
    finally
    {
      if (isNewest())
      {
        loading.value = false;
      }
    }
  }

  async function loadIndexFlags(): Promise<void>
  {
    const repoPath = repo.repo?.path;
    if (!repoPath)
    {
      return;
    }
    try
    {
      const flags = await api['stage:indexFlags'](repoPath);
      skipWorktree.value = toFilePaths(flags.skipWorktree);
      assumeUnchanged.value = toFilePaths(flags.assumeUnchanged);
    }
    catch
    {
      // A failure here (e.g. no index yet) must not stop the lists from loading: the flags are only a decoration on them.
      skipWorktree.value = [];
      assumeUnchanged.value = [];
    }
  }

  async function refresh(): Promise<void>
  {
    // Alongside the file reads, not in front of them: handed to `loadFiles`, which waits
    // for it before folding flagged paths into the unstaged list.
    await loadFiles(loadIndexFlags());
    await patch.loadPatch();
  }

  /**
   * Run a git command and re-read everything, so the lists, patch and repo status all
   * move together when the index changes. `console` forces the output window open for
   * the one command here that goes over the network: staging a file is a click you make
   * dozens of times, and a window per click is not what watching a command means.
   */
  async function run(
    argv: string[],
    invalidates: readonly RepoFacet[],
    options: { console?: boolean } = {}
  ): Promise<boolean>
  {
    const repoPath = repo.repo?.path;
    if (!repoPath)
    {
      return false;
    }
    try
    {
      await runConsoleSteps(
        repoPath,
        [{ label: `git ${argv[0]}`, argv }],
        invalidates,
        { console: options.console }
      );
      await repo.refresh();
      await refresh();
      return true;
    }
    catch (err)
    {
      error.value = toMessage(err);
      // What git actually said, which for a streamed run is in the console rather than
      // in `error`: `commit.ts` hands it to the push dialog to tell a rejection from a
      // refusal. See `ConsoleFailure`.
      if (err instanceof ConsoleFailure)
      {
        failureOutput.value = err.output;
      }
      else
      {
        failureOutput.value = error.value;
      }
      return false;
    }
  }

  const stageFiles = (paths: string[]): Promise<boolean> =>
  {
    if (paths.length)
    {
      return run([CMD_ADD, PATH_SEPARATOR, ...paths], STAGING);
    }
    else
    {
      return Promise.resolve(false);
    }
  };
  const unstageFiles = (paths: string[]): Promise<boolean> =>
  {
    if (paths.length)
    {
      return run([CMD_RESET, HEAD_REF, PATH_SEPARATOR, ...paths], STAGING);
    }
    else
    {
      return Promise.resolve(false);
    }
  };
  const stageAll = (): Promise<boolean> => run([CMD_ADD, FLAG_ALL], STAGING);
  const unstageAll = (): Promise<boolean> => run([CMD_RESET, HEAD_REF], STAGING);
  // The index already matches HEAD for an unstaged file, so this only moves what's on disk.
  const discard = (path: string): Promise<boolean> =>
    run([CMD_CHECKOUT, HEAD_REF, PATH_SEPARATOR, path], WORKING_TREE);

  /**
   * Stage or unstage part of the selected file. `lines` indexes the hunk's own line
   * array; omit for the whole hunk. Direction follows the side, not a parameter. File
   * and direction come from `patchTarget`, the patch on screen, not the selection: the
   * two disagree for as long as a read is in flight.
   */
  async function applyHunk(hunkIndex: number, lines?: ReadonlySet<number>): Promise<boolean>
  {
    const hunkTarget = hunkTargetOf(
      repo.repo?.path,
      patch.patchTarget.value,
      patch.patchFile.value,
      patch.patchFile.value?.hunks[hunkIndex]
    );
    if (!hunkTarget)
    {
      return false;
    }
    const { repoPath, target, file, hunk } = hunkTarget;

    let direction: StageDirection;
    switch (target.side)
    {
      case STAGING_SIDE_STAGED:
        direction = DIRECTION_UNSTAGE;
        break;
      default:
        direction = DIRECTION_STAGE;
        break;
    }
    const built = buildHunkPatch(file, hunk, { selected: lines, direction });
    // Null means the selection named no change, not an error, and not a git call.
    if (built === null)
    {
      return false;
    }

    try
    {
      await api['stage:applyPatch'](repoPath, built, direction);
      await repo.refresh();
      await refresh();
      // `target` was read before the index moved; after refresh this side's list may no longer hold the file.
      selection.followAcrossSides(target.path, target.side);
      return true;
    }
    catch (err)
    {
      error.value = toMessage(err);
      return false;
    }
  }

  return {
    loading,
    failureOutput,
    skipWorktree,
    assumeUnchanged,
    refresh,
    run,
    loadFiles,
    loadIndexFlags,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    discard,
    applyHunk
  };
}

export type StagingActions = ReturnType<typeof createStagingActions>;
