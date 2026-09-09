/**
 * Reading the log: the query, the batches streaming in, and cancelling either. One
 * responsibility, the round trip: `stream.ts` owns the commits this appends into,
 * `layout.ts` owns the graph this triggers.
 */

import { computed, ref, type ComputedRef } from 'vue';
import type { CommitRow, LogOptions } from '@shared/types.js';
import { api, toMessage } from '@renderer/api.js';
import { noteTiming } from '@renderer/diagnostics.js';
import { tokenizeBranchFilter } from '@renderer/model/branchFilter.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSelectionStore } from '@renderer/stores/selection.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import type { StreamState } from './stream.js';
import type { LayoutState } from './layout.js';

/** Monotonic, so a superseded read's batches can be recognised and dropped. */
let nextRequestId = 1;

const ORDER_DATE = 'date';

/** True once a pending replace has something to show for it: rows, or a finished empty read. */
function canReplaceRows(pendingReplace: boolean, batch: { commits: CommitRow[]; done: boolean }): boolean
{
  return pendingReplace && (batch.commits.length > 0 || batch.done);
}

export interface LoadingDeps {
  repo: ReturnType<typeof useRepoStore>;
  settings: ReturnType<typeof useSettingsStore>;
  selection: ReturnType<typeof useSelectionStore>;
  stream: StreamState;
  layout: LayoutState;
  rows: ComputedRef<CommitRow[]>;
}

export function createLoadingState({ repo, settings, selection, stream, layout, rows }: LoadingDeps)
{
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Total the query would return when a commit limit is truncating it. */
  const total = ref<number | null>(null);

  /**
   * The query. `limit`, `scope`, `refs`, `includeTags`, `includeRemoteBranches`,
   * `includeStashes`, `reflog` are deliberately absent: each is a persisted setting,
   * read at load time in `effectiveOptions` below. What's left is the Advanced Filter
   * dialog's own session-scoped fields, gone on the next repository load.
   */
  const options = ref<LogOptions>({ order: ORDER_DATE });

  /**
   * Paths the history is narrowed to, or empty for the whole thing: `git log --
   * <path>`, bound to `F` on the file pane. Its own ref, not a field of `options`, so
   * turning it on doesn't rebuild the query object and the grid can say it's on.
   */
  const pathFilter = ref<string[]>([]);

  async function setPathFilter(paths: readonly string[]): Promise<void>
  {
    pathFilter.value = [...paths];
    const repoPath = repo.repo?.path;
    if (repoPath)
    {
      await load(repoPath);
    }
  }

  const currentRequest = ref(0);
  /** When the current read was asked for, so the closing batch can say what it cost. */
  let startedAt = 0;

  /**
   * True while a reload is in flight whose rows haven't arrived yet. Rows on screen
   * stay until the replacement's first batch lands, so the `.git` watcher's refresh
   * doesn't blink the grid empty.
   */
  const pendingReplace = ref(false);

  /**
   * A commit to select the moment the current request's stream includes it. Set after
   * a commit, revert, cherry-pick, merge, rebase or reset moves HEAD onto a commit the
   * grid hasn't drawn. Bound to `currentRequest`: a superseding load overwrites it too, so a stale reveal can't land in the wrong stream.
   */
  const revealSha = ref<string | null>(null);

  /**
   * The options actually sent to git: the query plus everything the View menu's own
   * toggles own directly in settings. Read here rather than copied into `options`, so
   * changing one in the menu takes effect on the next load with nothing to keep in step.
   */
  const effectiveOptions = computed<LogOptions>(() =>
  {
    const scope = settings.settings.branchScope;
    const effective: LogOptions = {
      scope,
      // Only meaningful for `filtered`; harmless to compute either way, so no branch is needed for the other scopes.
      refs: tokenizeBranchFilter(settings.settings.branchFilter),
      includeTags: settings.settings.logShowTags,
      includeRemoteBranches: settings.settings.logShowRemoteBranches,
      includeStashes: settings.settings.logShowStashes,
      reflog: settings.settings.logShowReflog,
      ...options.value,
      limit: settings.settings.commitLoadLimit
    };
    if (pathFilter.value.length > 0)
    {
      effective.paths = [...pathFilter.value];
    }
    return effective;
  });

  /**
   * Load the log for `repoPath`, replacing whatever is shown. `revealHead`, when
   * given, is selected as soon as the reload's stream reaches it; silently a no-op if
   * it never appears (a scoped query can legitimately miss it).
   */
  async function load(repoPath: string, next?: LogOptions, opts?: { revealHead?: string }): Promise<void>
  {
    if (next)
    {
      options.value = next;
    }

    // "Until refresh": the highlight is an override on the graph being replaced,
    // dropped by the `.git` watcher rather than held across it.
    layout.highlightSeed.value = null;

    // Stop the previous read before discarding its rows, so a slow query can't deliver into the new list.
    if (currentRequest.value)
    {
      await api['revisions:cancel'](currentRequest.value);
    }

    const requestId = nextRequestId++;
    currentRequest.value = requestId;
    startedAt = performance.now();
    revealSha.value = opts?.revealHead ?? null;
    const query = effectiveOptions.value;

    // Deliberately not a full reset: current rows stay until the replacement arrives, so a refresh redraws in place.
    error.value = null;
    total.value = null;
    pendingReplace.value = true;
    loading.value = true;

    // Only interesting when a limit might hide commits, and costs a full rev-list walk, so never on the critical path to first paint.
    if (query.limit != null)
    {
      void api['revisions:count'](repoPath, query)
        .then((n) =>
        {
          if (currentRequest.value === requestId)
          {
            total.value = n;
          }
        })
        .catch(() =>
        {
          /* The count is an affordance, not information the grid depends on. */
        });
    }

    // A failure here means no batch will ever arrive, so it must clear `loading`, or it reads as a permanent "Loading…".
    try
    {
      await api['revisions:start'](requestId, repoPath, query);
    }
    catch (err)
    {
      if (currentRequest.value !== requestId)
      {
        return;
      }
      error.value = toMessage(err);
      loading.value = false;
      pendingReplace.value = false;
    }
  }

  /** Apply a batch from the main process, ignoring anything from a superseded read. */
  function onBatch(batch: {
    requestId: number;
    commits: CommitRow[];
    done: boolean;
    error?: string;
  }): void
  {
    if (batch.requestId !== currentRequest.value)
    {
      return;
    }

    // Swap old rows out only now that there's something to replace them; `done` clears the grid for a query matching nothing.
    if (canReplaceRows(pendingReplace.value, batch))
    {
      stream.clear();
      layout.graph.value = [];
      pendingReplace.value = false;
    }

    if (batch.commits.length > 0)
    {
      stream.appendBatch(batch.commits);
    }
    if (batch.error)
    {
      error.value = batch.error;
    }

    // Almost always in the first batch, but checked every batch since nothing here guarantees that.
    if (revealSha.value !== null && stream.rowOf(revealSha.value) !== undefined)
    {
      selection.select(revealSha.value);
      revealSha.value = null;
    }

    // Re-laying out on every batch would burn the whole frame budget on a fast
    // stream; the final pass is what the grid ends up drawing.
    if (batch.done)
    {
      // Before the layout, so the two costs are separate lines: the walk and the draw
      // fail for different reasons and a single total hides which one moved.
      noteTiming('log read', performance.now() - startedAt, [
        `${stream.commits.value.length} commits`
      ]);
      layout.relayout();
      // Only now, with the whole list in, can we say which selected commits are
      // genuinely gone. `rows` passed so a selected working-tree row survives a
      // reload: committing should drop it, not the reload it triggers.
      selection.retain(rows.value);
      // Never found: a scoped or filtered query hid it. Give up quietly rather than fire on some unrelated later load.
      revealSha.value = null;
      loading.value = false;
    }
    else if (layout.graph.value.length === 0 && stream.commits.value.length > 0)
    {
      // Except the first one: otherwise the first screenful renders without lanes.
      layout.relayout();
    }
  }

  /**
   * Forget a reveal that has not landed yet, because the user has picked a row.
   *
   * A reveal is the app saying "select whatever this operation moved HEAD to, once the
   * stream reaches it", and it can arrive several batches after the operation that asked.
   * A click made in the meantime is the person at the keyboard saying otherwise, and it
   * has to win: without this the grid takes the selection back a beat later, on a row
   * nobody asked for.
   */
  function cancelReveal(): void
  {
    revealSha.value = null;
  }

  async function cancel(): Promise<void>
  {
    if (!currentRequest.value)
    {
      return;
    }
    await api['revisions:cancel'](currentRequest.value);
    currentRequest.value = 0;
    loading.value = false;
    pendingReplace.value = false;
  }

  function reset(): void
  {
    error.value = null;
    total.value = null;
    pendingReplace.value = false;
  }

  return {
    loading,
    error,
    total,
    pendingReplace,
    options,
    pathFilter,
    setPathFilter,
    effectiveOptions,
    load,
    onBatch,
    cancelReveal,
    cancel,
    reset
  };
}

export type LoadingState = ReturnType<typeof createLoadingState>;
