<script setup lang="ts">
/**
 * The console: what git is running right now, and what it is saying, in a window of its
 * own rather than inside the dialog that asked for it. `useStreamWatch` follows runs
 * that window started, so this one only ever watches and can be closed at any point
 * without touching them.
 *
 * A successful console closes itself, after `commandOutputAutoCloseSeconds`; a failed
 * one never does, since that is when the output is worth reading.
 */

import { computed, onUnmounted, ref, watch } from 'vue';
import type { OutputStep } from '@shared/dialogs.js';
import { useStreamWatch } from '@renderer/composables/useStreamWatch.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import CodeText from '@renderer/components/ui/CodeText.vue';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import OutputPane from '@renderer/components/transparency/OutputPane.vue';

const props = withDefaults(
  defineProps<{
    steps: readonly OutputStep[];
    /**
     * Stay up when the run succeeds. Set for a command whose output *is* the answer:
     * a `--dry-run` listing, a `clean` naming what it removed. Auto-close is for
     * progress, and progress is over when the thing it was about is done.
     */
    keepOpen?: boolean;
  }>(),
  { keepOpen: false }
);

const emit = defineEmits<{ close: [] }>();

const settings = useSettingsStore();
const watchState = useStreamWatch(props.steps);

/**
 * The finished lines, and under them the one still being written. That last line is
 * replaced as git rewrites it rather than appended to, which is what a progress meter
 * looks like in a terminal and what keeps a phase from arriving as one run-together line.
 */
const text = computed(() =>
{
  const shown = [...watchState.lines.value];
  if (watchState.partial.value)
  {
    shown.push(watchState.partial.value);
  }
  return shown.join('\n');
});

const MS_PER_SECOND = 1000;

/** A finished command that printed nothing said so; a running one is just not there yet. */
const placeholder = computed(() =>
{
  if (watchState.finished.value)
  {
    return 'git printed nothing.';
  }
  return 'Waiting for git…';
});

const outcome = computed(() =>
{
  if (!watchState.finished.value)
  {
    return null;
  }
  if (watchState.error.value)
  {
    return { text: watchState.error.value, kind: 'error' as const };
  }
  if (watchState.exitCode.value === null)
  {
    return { text: 'Stopped.', kind: 'warn' as const };
  }
  if (watchState.exitCode.value !== 0)
  {
    const step = props.steps[watchState.stepIndex.value];
    return {
      text: `\`git ${step?.argv[0] ?? ''}\` exited ${watchState.exitCode.value}.`,
      kind: 'error' as const
    };
  }
  return { text: 'Done.', kind: 'success' as const };
});

/** Only a clean finish closes itself: a failure is the case this window exists for. */
const succeeded = computed(() => outcome.value?.kind === 'success');

/**
 * The pending auto-close, as a ref: the template decides whether to offer Keep Open
 * from it, and a plain `let` is not something Vue re-renders on.
 */
const closing = ref<ReturnType<typeof setInterval> | null>(null);

/**
 * Seconds left before this window closes itself, or null when nothing is counting.
 *
 * Counted down a second at a time rather than set once, because the number is on the
 * button: a window that vanishes while you are still reading it reads as a glitch, and
 * the same window counting "Close (3)… (2)… (1)" is telling you what it is about to do
 * and offering Keep Open beside it. How long is `commandOutputAutoCloseSeconds`.
 */
const remaining = ref<number | null>(null);

watch(succeeded, (done) =>
{
  if (!done || props.keepOpen || !settings.settings.commandOutputAutoClose)
  {
    return;
  }
  const seconds = Math.max(0, settings.settings.commandOutputAutoCloseSeconds);
  if (seconds === 0)
  {
    emit('close');
    return;
  }
  remaining.value = seconds;
  closing.value = setInterval(() =>
  {
    const left = (remaining.value ?? 0) - 1;
    remaining.value = left;
    if (left <= 0)
    {
      stopClosing();
      emit('close');
    }
  }, MS_PER_SECOND);
});

/** Stop the countdown, leaving the window where it is. */
function stopClosing(): void
{
  if (closing.value)
  {
    clearInterval(closing.value);
    closing.value = null;
  }
  remaining.value = null;
}

/** Anything the reader does here is a decision to keep the window: stop closing it. */
const kept = ref(false);

function keepOpen(): void
{
  stopClosing();
  kept.value = true;
}

onUnmounted(stopClosing);
</script>

<template>
  <DialogFrame title="Git Output" fixed-height @close="emit('close')">
    <div class="console">
      <CommandPreview :steps="props.steps.map((step) => ({ argv: step.argv }))" />

      <OutputPane :text="text" :placeholder="placeholder" follow class="pane" />

      <p v-if="outcome" :class="outcome.kind"><CodeText :text="outcome.text" /></p>
    </div>

    <template #actions>
      <button v-if="succeeded && closing && !kept" @click="keepOpen">Keep Open</button>
      <button v-if="watchState.running.value" class="danger" @click="watchState.cancel()">
        Stop
      </button>
      <!-- The count is on the button that does the closing, so the thing about to happen
           is named by the control that will do it. -->
      <button class="primary" @click="emit('close')">
        {{ remaining === null ? 'Close' : `Close (${remaining})` }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* The pane is the window: it takes whatever height is left, rather than the 220px an
   output pane inside a form is held to. */
.console {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  min-height: 0;
}

.pane {
  flex: 1;
  max-height: none;
  min-height: 0;
}
</style>
