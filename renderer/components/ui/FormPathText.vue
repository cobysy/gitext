<script setup lang="ts">
/**
 * Path field with browse button: folds two controls into one (field + picker shortcut).
 * Picking stays caller's (different dialogs use different pickers).
 */

import FormText from '@renderer/components/ui/FormText.vue';
import Glyph from '@renderer/components/ui/Glyph.vue';

withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    placeholder?: string;
    disabled?: boolean;
    /** Read by screen readers and shown as the browse button's tooltip. */
    browseLabel?: string;
  }>(),
  { browseLabel: 'Browse…' }
);

const emit = defineEmits<{ browse: [] }>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <FormText
    v-model="model"
    :label="label"
    :hint="hint"
    :placeholder="placeholder"
    :disabled="disabled"
  >
    <template #addon>
      <button
        type="button"
        class="browse"
        :disabled="disabled"
        :title="browseLabel"
        :aria-label="browseLabel"
        @click="emit('browse')"
      >
        <!-- A folder outline: the same glyph a native picker button wears, so this reads
             as "browse for a path" without needing its own label to say so. -->
        <Glyph name="folder" :size="14" />
      </button>
    </template>
  </FormText>
</template>

<style scoped>
.browse {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  padding: 0;
  color: var(--fg-subtle);
}

.browse:hover:not(:disabled) {
  color: var(--fg);
}
</style>
