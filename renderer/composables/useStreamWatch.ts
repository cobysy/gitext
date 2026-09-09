/**
 * Follow runs somebody else started: the console window's half of `useGitStream`.
 *
 * The ids are minted before the first command starts and handed over in the payload,
 * so this window can watch a whole multi-command operation from one end to the other
 * without owning any of it. It never calls `stream:start`: the window that asked for
 * the operation is still awaiting it, and two starters would be two runs.
 */

import { onUnmounted, readonly, ref, type DeepReadonly, type Ref } from 'vue';
import type { OutputStep } from '@shared/dialogs.js';
import { api } from '@renderer/api.js';

const EVENT_STREAM_LINE = 'event:streamLine';

export interface StreamWatch {
  /** Every line so far, across every step, in arrival order. */
  lines: DeepReadonly<Ref<string[]>>;
  /**
   * The line git is still writing, under the finished ones: a progress meter rewrites
   * one line for a whole phase, and this is where it moves while it does.
   */
  partial: Readonly<Ref<string>>;
  /** Which step is running, as an index into the steps watched. */
  stepIndex: Readonly<Ref<number>>;
  running: Readonly<Ref<boolean>>;
  /** True once the last step has finished, or an earlier one failed. */
  finished: Readonly<Ref<boolean>>;
  /** The exit code that ended the watch. Null while running, and after a cancel. */
  exitCode: Readonly<Ref<number | null>>;
  /** Set when git could not be spawned at all. Not set by a non-zero exit. */
  error: Readonly<Ref<string | null>>;
  /** Stop the step now running. The closing batch still arrives and settles the state. */
  cancel(): void;
}

/** A step's own heading in the output, for an operation that is more than one command. */
function heading(step: OutputStep): string
{
  return `── ${step.label} ──`;
}

export function useStreamWatch(steps: readonly OutputStep[]): StreamWatch
{
  const lines = ref<string[]>([]);
  const stepIndex = ref(0);
  const running = ref(steps.length > 0);
  const finished = ref(steps.length === 0);
  const exitCode = ref<number | null>(null);
  const error = ref<string | null>(null);
  const partial = ref('');

  if (steps.length > 1 && steps[0])
  {
    lines.value.push(heading(steps[0]));
  }

  /** Nothing more to watch: the last step ended, or one of them failed. */
  function settle(batch: { exitCode?: number | null; error?: string }): void
  {
    // Whatever was half-written has ended by now, and arrived in `lines` with it.
    partial.value = '';
    running.value = false;
    finished.value = true;
    exitCode.value = batch.exitCode ?? null;
    error.value = batch.error ?? null;
  }

  const off = api.on(EVENT_STREAM_LINE, (batch) =>
  {
    const current = steps[stepIndex.value];
    if (!current || batch.requestId !== current.requestId)
    {
      return;
    }
    if (batch.lines.length > 0)
    {
      lines.value.push(...batch.lines);
    }
    partial.value = batch.partial ?? '';
    if (!batch.done)
    {
      return;
    }

    const failed = !!batch.error || batch.exitCode !== 0;
    const next = steps[stepIndex.value + 1];
    if (failed || !next)
    {
      settle(batch);
      return;
    }

    stepIndex.value += 1;
    lines.value.push('', heading(next));
  });

  /**
   * Catch up on what was missed. This window is opened by the window that starts the
   * runs, so a quick command can be over before this one has mounted: without asking,
   * the console would sit watching a run that had already ended.
   */
  async function catchUp(): Promise<void>
  {
    for (const [index, step] of steps.entries())
    {
      // Only up to the step being watched: a later one has not been started yet, and
      // the subscription above is what will report it.
      if (index > stepIndex.value)
      {
        return;
      }
      const state = await api['stream:state'](step.requestId);
      if (!state || index !== stepIndex.value)
      {
        continue;
      }
      // Whatever the subscription has already appended is the same run's lines: take
      // main's copy as the whole truth rather than merging two partial ones.
      lines.value = lines.value.slice(0, headingCount(index)).concat(state.lines);
      partial.value = state.partial ?? '';
      if (!state.done)
      {
        continue;
      }
      const failed = !!state.error || state.exitCode !== 0;
      const next = steps[index + 1];
      if (failed || !next)
      {
        settle(state);
        return;
      }
      stepIndex.value = index + 1;
      lines.value.push('', heading(next));
    }
  }

  /** How many lines of this watch's own headings precede step `index`'s output. */
  function headingCount(index: number): number
  {
    if (steps.length < 2)
    {
      return 0;
    }
    // One heading for the first step, then a blank line and a heading for each after it.
    return 1 + index * 2;
  }

  function cancel(): void
  {
    const current = steps[stepIndex.value];
    if (!current || !running.value)
    {
      return;
    }
    void api['stream:cancel'](current.requestId);
  }

  // A step that is already over settles now: there is no stream coming for it.
  const first = steps[0];
  if (first?.finished)
  {
    lines.value.push(...first.finished.lines);
    settle({ exitCode: first.finished.exitCode });
  }
  else
  {
    void catchUp();
  }

  onUnmounted(off);

  return {
    lines: readonly(lines),
    partial: readonly(partial),
    stepIndex: readonly(stepIndex),
    running: readonly(running),
    finished: readonly(finished),
    exitCode: readonly(exitCode),
    error: readonly(error),
    cancel
  };
}
