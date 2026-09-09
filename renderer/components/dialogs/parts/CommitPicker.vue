<script setup lang="ts">
/**
 * Revision expression field with resolved commit underneath. Typing is safe:
 * summary shows what resolves before confirming. CommitSummary handles resolving.
 */

import { computed } from 'vue';
import { REF_KIND_BRANCH, REF_KIND_TAG } from '@shared/types.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import FormRow from '@renderer/components/ui/FormRow.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommitSummary from './CommitSummary.vue';

const model = defineModel<string>({ required: true });

const props = withDefaults(
  defineProps<{
    label?: string;
    /**
     * Label for the resolved summary. Separate from label: "Commit" wants
     * "Which is", not a generic "Starts at".
     */
    summaryLabel?: string;
    /** Fixed by parent: shown and resolved but not editable. */
    readonly?: boolean;
    disabled?: boolean;
  }>(),
  { label: 'Starting point', summaryLabel: 'Starts at' }
);

const objects = useRepoObjectsStore();

/**
 * Local branches and tags only: remote branches are for checkout dialog's
 * create-local option.
 */
const shortcuts = computed(() =>
  objects.refs.filter((ref) => ref.kind === REF_KIND_BRANCH || ref.kind === REF_KIND_TAG).map((ref) => ref.name)
);
</script>

<template>
  <FormText
    v-model="model"
    :label="props.label"
    :readonly="props.readonly"
    :disabled="props.disabled"
    placeholder="HEAD"
  />
  <FormRow v-if="!props.readonly && !props.disabled && shortcuts.length" indent>
    <select class="shortcuts" :value="''" @change="model = ($event.target as HTMLSelectElement).value">
      <option value="" disabled>Or pick a ref…</option>
      <option v-for="name in shortcuts" :key="name" :value="name">{{ name }}</option>
    </select>
  </FormRow>
  <CommitSummary :rev="model" :label="props.summaryLabel" />
</template>

<style scoped>
.shortcuts {
  max-width: 260px;
}
</style>
