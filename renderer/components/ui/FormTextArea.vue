<script setup lang="ts">
/**
 * Multi-line field: separate from FormText (Enter belongs to field, not dialog).
 * Proportional font by default (prose, not code).
 */

import FormRow from '@renderer/components/ui/FormRow.vue';

const model = defineModel<string>({ required: true });

withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    placeholder?: string;
    rows?: number;
    readonly?: boolean;
    disabled?: boolean;
    monospace?: boolean;
  }>(),
  { rows: 4, monospace: false }
);
</script>

<template>
  <FormRow :label="label" :hint="hint" stacked>
    <textarea
      v-model="model"
      :class="{ mono: monospace }"
      :rows="rows"
      :placeholder="placeholder"
      :readonly="readonly"
      :disabled="disabled"
      @keydown.enter.stop
    />
  </FormRow>
</template>

<style scoped>
textarea {
  width: 100%;
  resize: vertical;
}

textarea.mono {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

textarea:read-only {
  background: var(--bg-subtle);
  color: var(--fg-muted);
}

textarea:disabled {
  opacity: 0.5;
}
</style>
