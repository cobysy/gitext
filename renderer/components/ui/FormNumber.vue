<script setup lang="ts">
/**
 * Number field. Separate from FormText because it needs min/max/step. Empty box
 * reports null ("no limit"), not 0.
 */

import FormRow from '@renderer/components/ui/FormRow.vue';

const model = defineModel<number | null>({ required: true });

defineProps<{
  label?: string;
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  stacked?: boolean;
}>();

function onChange(event: Event): void
{
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === '')
  {
    model.value = null;
    return;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed))
  {
    model.value = parsed;
  }
}
</script>

<template>
  <FormRow :label="label" :hint="hint" :stacked="stacked">
    <input
      type="number"
      :value="model ?? ''"
      :min="min"
      :max="max"
      :step="step"
      :placeholder="placeholder"
      @change="onChange"
    />
  </FormRow>
</template>

<style scoped>
input {
  width: 100%;
}
</style>
