<script setup lang="ts">
/**
 * Branch/tag picker: shows distance (ahead/behind) and current branch marking.
 * Reads refs from store (loaded fresh for dialog).
 */

import { computed } from 'vue';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import FormSelect, { type SelectOption } from '@renderer/components/ui/FormSelect.vue';

const model = defineModel<string>({ required: true });

const props = withDefaults(
  defineProps<{
    /** Which kinds to offer. Order is the order they appear in. */
    kinds?: readonly ('branch' | 'remote' | 'tag')[];
    label?: string;
    hint?: string;
    placeholder?: string;
    disabled?: boolean;
    /** Leave the checked-out branch out: you cannot merge a branch into itself. */
    excludeCurrent?: boolean;
    /** One remote's branches only, for the dialogs that have already picked a remote. */
    remote?: string;
    /**
     * First row meaning "no ref" (value: ''). Needed where "none" is a real answer (placeholder can't be re-chosen).
     */
    none?: string;
    /**
     * Include this value even if not in ref lists (e.g. payload SHA for merge).
     */
    extra?: string;
  }>(),
  { kinds: () => ['branch', 'tag'], label: 'Branch', placeholder: 'Pick a branch…' }
);

/** `feature (2 ahead, 1 behind)`: the distance, only when there is one to report. */
function describe(name: string, ahead: number, behind: number, isCurrent: boolean): string
{
  const parts: string[] = [];
  if (isCurrent)
  {
    parts.push('current');
  }
  if (ahead > 0)
  {
    parts.push(`${ahead} ahead`);
  }
  if (behind > 0)
  {
    parts.push(`${behind} behind`);
  }
  if (parts.length > 0)
  {
    return `${name} (${parts.join(', ')})`;
  }
  else
  {
    return name;
  }
}

const objects = useRepoObjectsStore();

const options = computed<SelectOption[]>(() =>
{
  const wanted = new Set(props.kinds);
  const listed = objects.refs
    .filter((ref) => wanted.has(ref.kind))
    .filter((ref) => !(props.excludeCurrent && ref.isCurrent))
    .filter((ref) => !props.remote || ref.remote === props.remote)
    // The kinds in the order they were asked for, and each kind in the order the panel
    // lists it, which is already what `refs:list` returns.
    .sort((a, b) => props.kinds.indexOf(a.kind) - props.kinds.indexOf(b.kind))
    .map((ref) => ({
      value: ref.name,
      label: describe(ref.name, ref.ahead, ref.behind, ref.isCurrent)
    }));

  // First, not appended: it is what the dialog was opened about, so it is what should be
  // showing when the dialog opens.
  if (props.extra && !listed.some((option) => option.value === props.extra))
  {
    listed.unshift({ value: props.extra, label: props.extra });
  }
  if (props.none)
  {
    listed.unshift({ value: '', label: props.none });
  }
  return listed;
});
</script>

<template>
  <FormSelect
    v-model="model"
    :options="options"
    :label="label"
    :hint="hint"
    :placeholder="none ? undefined : placeholder"
    :disabled="disabled"
  />
</template>
