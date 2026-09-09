<script setup lang="ts">
/**
 * Checkbox to set a choice as default. Users answer the same way repeatedly; a dialog
 * that can't learn that is frustrating. Ensures consistent wording everywhere. The
 * setting is saved only on success, not on cancel.
 */

import FormCheck from '@renderer/components/ui/FormCheck.vue';

const model = defineModel<boolean>({ required: true });

withDefaults(
  defineProps<{
    /** What is being remembered, e.g. "this choice for local changes". */
    what?: string;
    disabled?: boolean;
  }>(),
  { what: 'this choice' }
);
</script>

<template>
  <FormCheck
    v-model="model"
    label="Set as default"
    :hint="`Remember ${what} and preselect it next time.`"
    :disabled="disabled"
  />
</template>
