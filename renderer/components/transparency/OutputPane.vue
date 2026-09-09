<script setup lang="ts">
/**
 * The one pane of git output: the console window's, and each stream of a command log
 * record's. Scrolls rather than growing its container, and follows the bottom unless
 * the reader has scrolled up to read something.
 */

import { useTemplateRef, watch } from 'vue';
import { useFollowTail } from '@renderer/composables/useFollowTail.js';

const props = withDefaults(
  defineProps<{
    text: string;
    /** Placeholder text. */
    placeholder?: string;
    /** Follow bottom as text arrives. */
    follow?: boolean;
    /**
     * These are a failure's words. git writes a fetch's whole progress to stderr, so
     * which stream it came from is not the question: whether it went wrong is.
     */
    failed?: boolean;
  }>(),
  { placeholder: '', follow: false, failed: false }
);

const pane = useTemplateRef<HTMLElement>('pane');
const { onScroll, stick } = useFollowTail(pane);

watch(
  () => props.text,
  async () =>
  {
    if (!props.follow)
    {
      return;
    }
    await stick();
  },
  { immediate: true }
);
</script>

<template>
  <pre
    ref="pane"
    class="output selectable"
    :class="{ failed }"
    @scroll="onScroll"
  >{{ text || placeholder }}</pre>
</template>

<style scoped>
.output {
  margin: 0;
  padding: var(--space-2);
  max-height: 220px;
  overflow: auto;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.output.failed {
  color: var(--danger);
}
</style>
