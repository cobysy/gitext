<script setup lang="ts">
/**
 * Checkbox with label and hint. Hint teaches the command-line flag. Layout managed
 * by controlText.css.
 */

import CodeText from './CodeText.vue';
import HintText from './HintText.vue';

const model = defineModel<boolean>({ required: true });

defineProps<{
  label: string;
  hint?: string;
  disabled?: boolean;
}>();
</script>

<template>
  <label class="check" :class="{ disabled }">
    <input v-model="model" type="checkbox" :disabled="disabled" />
    <span class="text">
      <span><CodeText :text="label" /></span>
      <HintText v-if="hint" :text="hint" />
    </span>
  </label>
</template>

<style scoped src="@renderer/styles/controlText.css"></style>
<style scoped>
.check {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.check.disabled {
  opacity: 0.5;
}
</style>
