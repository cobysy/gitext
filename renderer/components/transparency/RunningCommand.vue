<script setup lang="ts">
/**
 * The line a dialog's footer carries while git runs: the command, which step of how
 * many, the seconds it has taken, and Stop. A disabled button alone cannot tell a slow
 * command from a hung one from one that never started; a clock that keeps moving beside
 * the command that is running can.
 *
 * Silent for the first second: most commands are over before then, and a line that
 * flashes up and away on every click reads as something going wrong.
 */

import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { RUN_ACTIVITY } from '@renderer/composables/runActivity.js';
import { gitCommandLine } from '@renderer/model/commandLine.js';
import { elapsedText } from '@renderer/model/elapsed.js';

const SHOW_AFTER_MS = 1000;
const TICK_MS = 250;

const view = inject(RUN_ACTIVITY, null);
const activity = computed(() => view?.activity.value ?? null);

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

function stopTicking(): void
{
  if (timer !== null)
  {
    clearInterval(timer);
    timer = null;
  }
}

// The clock runs only while something does: a dialog sitting idle sets no timer at all.
watch(
  () => activity.value !== null,
  (running) =>
  {
    stopTicking();
    if (running)
    {
      now.value = Date.now();
      timer = setInterval(() => (now.value = Date.now()), TICK_MS);
    }
  },
  { immediate: true }
);
onBeforeUnmount(stopTicking);

const elapsedMs = computed(() =>
{
  if (!activity.value)
  {
    return 0;
  }
  return now.value - activity.value.startedAt;
});

const shown = computed(() => activity.value !== null && elapsedMs.value >= SHOW_AFTER_MS);

const line = computed(() =>
{
  const current = activity.value;
  if (!current)
  {
    return '';
  }
  if (current.argv.length > 0)
  {
    return gitCommandLine(current.argv);
  }
  return current.label;
});

const progress = computed(() =>
{
  const current = activity.value;
  if (!current || current.count < 2)
  {
    return elapsedText(elapsedMs.value);
  }
  return `${current.index + 1} of ${current.count} · ${elapsedText(elapsedMs.value)}`;
});

const stopLabel = computed(() =>
{
  if (activity.value?.stopping)
  {
    return 'Stopping…';
  }
  return 'Stop';
});
</script>

<template>
  <div v-if="shown && activity" class="running" role="status">
    <code class="cmd truncate" :title="line">{{ line }}</code>
    <span class="progress">{{ progress }}</span>
    <button v-if="activity.stop" :disabled="activity.stopping" @click="view?.stop()">
      {{ stopLabel }}
    </button>
  </div>
</template>

<style scoped>
/* Takes the footer's free left side, so the buttons stay where they were. */
.running {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

.cmd {
  min-width: 0;
  font-family: var(--font-mono);
}

/* Fixed-width digits, so the line does not shuffle sideways every second. */
.progress {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}

.running button {
  flex: none;
  margin-right: auto;
}
</style>
