<script setup lang="ts">
/**
 * Draggable pane resizer: shared component so one hit target and hover color everywhere.
 * Orientation from composable (not prop) to prevent cross-mismatch bugs.
 */

import type { PaneSplitter } from '@renderer/composables/useSplitter.js';

const props = defineProps<{ pane: PaneSplitter }>();
</script>

<template>
  <div
    class="splitter"
    :class="{ vertical: props.pane.vertical.value }"
    role="separator"
    :aria-orientation="props.pane.vertical.value ? 'vertical' : 'horizontal'"
    @mousedown.prevent="props.pane.start"
  />
</template>

<style scoped>
/* 4px: a 1px line is a 1px target, and the pointer misses it. */
.splitter {
  flex: none;
  height: 4px;
  cursor: ns-resize;
  background: var(--border-subtle);
}

.splitter.vertical {
  width: 4px;
  height: auto;
  cursor: ew-resize;
}

/* Quiet on hover: the resize cursor already says the bar is draggable, and an accent line
   lighting up under the pointer made every pass across the window flash. */
.splitter:hover {
  background: var(--border);
}
</style>
