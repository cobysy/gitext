<script setup lang="ts">
/**
 * Labeled form row: fixed-width label column so every dialog's rows line up.
 * Component over per-dialog CSS prevents 27 dialogs from drifting apart.
 */

import CodeText from './CodeText.vue';
import HintText from './HintText.vue';

defineProps<{
  label?: string;
  /** A line under the control, explaining what the option does. */
  hint?: string;
  /** Put the control under the label rather than beside it: for a wide one. */
  stacked?: boolean;
  /** Reserve label column for sub-control (reads as part of row above, not new question). */
  indent?: boolean;
}>();
</script>

<template>
  <label class="row" :class="{ stacked }">
    <span v-if="label" class="label"><CodeText :text="label" /></span>
    <span v-else-if="indent" class="label" aria-hidden="true" />
    <span class="control">
      <slot />
      <HintText v-if="hint" :text="hint" />
    </span>
  </label>
</template>

<style scoped>
.row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.row.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
}

.label {
  flex: none;
  width: 120px;
  color: var(--fg);
}

.row.stacked .label {
  width: auto;
}

.control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
