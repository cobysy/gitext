<script setup lang="ts">
/**
 * A text field in a form row.
 *
 * `monospace` is not decoration: a branch name, a path or a SHA is read character by
 * character, and a proportional font makes `rn` and `m` the same shape.
 */

import { ref } from 'vue';
import FormRow from '@renderer/components/ui/FormRow.vue';

const model = defineModel<string>({ required: true });

/** Input element: exposed for RenameFileDialog's setSelectionRange (dialog's business, not field's). */
const input = ref<HTMLInputElement | null>(null);
defineExpose({ input });

withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    placeholder?: string;
    readonly?: boolean;
    disabled?: boolean;
    monospace?: boolean;
    stacked?: boolean;
    /** Focus this field when the dialog opens. One per dialog. */
    autofocus?: boolean;
  }>(),
  { monospace: true }
);
</script>

<template>
  <FormRow :label="label" :hint="hint" :stacked="stacked">
    <span class="field">
      <input
        ref="input"
        v-model="model"
        type="text"
        :class="{ mono: monospace }"
        :placeholder="placeholder"
        :readonly="readonly"
        :disabled="disabled"
        v-bind="autofocus ? { autofocus: true } : {}"
      />
      <!-- Companion action (FormPathText's browse button). Empty for other fields. -->
      <slot name="addon" />
    </span>
  </FormRow>
</template>

<style scoped>
.field {
  display: flex;
  align-items: stretch;
  gap: var(--space-1);
  width: 100%;
}

input {
  flex: 1;
  min-width: 0;
}

input.mono {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

input:read-only {
  background: var(--bg-subtle);
  color: var(--fg-muted);
}

input:disabled {
  opacity: 0.5;
}
</style>
