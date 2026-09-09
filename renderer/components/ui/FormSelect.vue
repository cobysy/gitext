<script setup lang="ts">
/**
 * Dropdown field. Options are objects so callers can hand mapped lists (refs, remotes, etc).
 */

import FormRow from '@renderer/components/ui/FormRow.vue';

export interface SelectOption {
  value: string;
  label: string;
}

const model = defineModel<string>({ required: true });

defineProps<{
  options: readonly SelectOption[];
  label?: string;
  hint?: string;
  /** Shown as a disabled first row while nothing is chosen. */
  placeholder?: string;
  disabled?: boolean;
  stacked?: boolean;
}>();
</script>

<template>
  <FormRow :label="label" :hint="hint" :stacked="stacked">
    <select v-model="model" :disabled="disabled">
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </FormRow>
</template>

<style scoped>
/* Width only; appearance is in global.css. */
select {
  width: 100%;
}
</style>
