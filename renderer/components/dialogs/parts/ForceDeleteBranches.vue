<script setup lang="ts">
/**
 * The `--force` row under a set of branches about to be deleted, and the warning it
 * earns once ticked over branches whose commits are on nothing else. Disabled while
 * everything picked is merged: there is nothing for the flag to override.
 */

import { computed } from 'vue';
import type { RefEntry } from '@shared/types.js';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';

const props = defineProps<{ unmerged: readonly RefEntry[] }>();

const force = defineModel<boolean>({ required: true });

const NAMED_AT_MOST = 3;

const hint = computed(() =>
{
  if (props.unmerged.length === 0)
  {
    return 'Everything selected is already merged.';
  }
  // Named while a list of names still reads at a glance; counted past that.
  if (props.unmerged.length > NAMED_AT_MOST)
  {
    return `\`--force\`: ${props.unmerged.length} of them would otherwise be refused.`;
  }
  const names = props.unmerged.map((entry) => `\`${entry.name}\``).join(', ');
  return `\`--force\`: ${names} would otherwise be refused.`;
});

const subject = computed(() =>
{
  if (props.unmerged.length === 1)
  {
    return '1 branch has';
  }
  return `${props.unmerged.length} branches have`;
});
</script>

<template>
  <FormCheck
    v-model="force"
    label="Delete even the ones that are not merged"
    :disabled="!unmerged.length"
    :hint="hint"
  />

  <DangerNote v-if="force && unmerged.length">
    {{ subject }} commits on no other branch. Deleting them leaves those commits reachable
    only through the reflog.
  </DangerNote>
</template>
