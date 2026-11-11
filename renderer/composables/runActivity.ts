/**
 * What a dialog is running right now, for the line its frame draws while it runs: the
 * command, which step of how many, how long it has taken, and a way to stop it.
 *
 * Owned by `useDialog`, which every dialog already calls, and handed to `DialogFrame`,
 * which every dialog already draws, through provide/inject. So every dialog shows it,
 * and none of them had to be told to.
 */

import { ref, type InjectionKey, type Ref } from 'vue';

export interface RunActivity {
  /** What is running: a step's label, or the sentence `perform` was given. */
  label: string;
  /** The command, when the step is one; empty for work through a channel of its own. */
  argv: readonly string[];
  /** Zero-based. */
  index: number;
  count: number;
  /** When the whole run began, not this step: the clock is for the thing the user asked for. */
  startedAt: number;
  /** Kills the running step; null where there is nothing to kill. */
  stop: (() => void) | null;
  /** Stop has been asked for, so the failure that follows reads as stopped. */
  stopping: boolean;
}

/** One step starting, as a runner reports it. */
export interface StepStart {
  label: string;
  argv: readonly string[];
  index: number;
  count: number;
  stop: (() => void) | null;
}

/** What a runner is handed to report its steps through, and to learn that Stop was pressed. */
export interface StepWatcher {
  started: (step: StepStart) => void;
  readonly stopping: boolean;
}

/** What `DialogFrame` is given: the activity to draw, and its Stop. */
export interface RunActivityView {
  activity: Readonly<Ref<RunActivity | null>>;
  stop: () => void;
}

export const RUN_ACTIVITY: InjectionKey<RunActivityView> = Symbol('runActivity');

export function createRunActivity()
{
  const activity = ref<RunActivity | null>(null);

  /** A run is starting: the clock starts here, for every step that follows. */
  function begin(label: string): StepWatcher
  {
    const startedAt = Date.now();
    activity.value = { label, argv: [], index: 0, count: 1, startedAt, stop: null, stopping: false };
    return {
      started(step: StepStart): void
      {
        const stopping = activity.value?.stopping ?? false;
        activity.value = { ...step, startedAt, stopping };
      },
      get stopping(): boolean
      {
        return activity.value?.stopping ?? false;
      }
    };
  }

  function end(): void
  {
    activity.value = null;
  }

  /** The frame's Stop. */
  function stop(): void
  {
    const now = activity.value;
    if (!now?.stop || now.stopping)
    {
      return;
    }
    activity.value = { ...now, stopping: true };
    now.stop();
  }

  return { activity, begin, end, stop };
}
