/**
 * Watch output of long-running git commands (gc, fsck, prune).
 * Differs from useDialog: streams progress output, cancelable, stays open until done.
 */

import { onUnmounted, readonly, ref, type DeepReadonly, type Ref } from 'vue';
import type { RepoFacet } from '@shared/invalidation.js';
import { api } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { nextStreamRequestId } from './streamRequestId.js';

const EVENT_STREAM_LINE = 'event:streamLine';

export interface GitStream {
  /** Every line git has written, both streams interleaved in arrival order. */
  lines: DeepReadonly<Ref<string[]>>;
  running: Readonly<Ref<boolean>>;
  /** The last run's exit code. Null while running, and after a cancel. */
  exitCode: Readonly<Ref<number | null>>;
  /** Set when git could not be spawned at all. Not set by a non-zero exit. */
  error: Readonly<Ref<string | null>>;
  /** True once a run has finished: what tells a pane to show its outcome line. */
  finished: Readonly<Ref<boolean>>;
  start(argv: string[], facets: readonly RepoFacet[]): void;
  cancel(): void;
  /** Throw away the previous run's output, so the next one starts from an empty pane. */
  clear(): void;
}

export function useGitStream(): GitStream
{
  const repo = useRepoStore();

  const lines = ref<string[]>([]);
  const running = ref(false);
  const exitCode = ref<number | null>(null);
  const error = ref<string | null>(null);
  const finished = ref(false);

  /** The run whose batches are ours. Anything else on the channel belongs to a sibling. */
  let currentId: number | null = null;

  const off = api.on(EVENT_STREAM_LINE, (batch) =>
  {
    if (batch.requestId !== currentId)
    {
      return;
    }
    if (batch.lines.length > 0)
    {
      lines.value.push(...batch.lines);
    }
    if (!batch.done)
    {
      return;
    }

    running.value = false;
    finished.value = true;
    exitCode.value = batch.exitCode ?? null;
    error.value = batch.error ?? null;
    currentId = null;
  });

  function clear(): void
  {
    lines.value = [];
    exitCode.value = null;
    error.value = null;
    finished.value = false;
  }

  function start(argv: string[], facets: readonly RepoFacet[]): void
  {
    const repoPath = repo.repo?.path;
    if (!repoPath || running.value)
    {
      return;
    }
    clear();
    currentId = nextStreamRequestId();
    running.value = true;
    void api['stream:start'](currentId, repoPath, argv, facets);
  }

  function cancel(): void
  {
    if (currentId === null)
    {
      return;
    }
    void api['stream:cancel'](currentId);
    // Deliberately not clearing `running` here: main still sends a closing batch after the
    // kill, and that is what settles the state. Clearing it now would show the command as
    // finished while its process was still dying.
  }

  onUnmounted(() =>
  {
    cancel();
    off();
  });

  return {
    lines: readonly(lines),
    running: readonly(running),
    exitCode: readonly(exitCode),
    error: readonly(error),
    finished: readonly(finished),
    start,
    cancel,
    clear
  };
}
