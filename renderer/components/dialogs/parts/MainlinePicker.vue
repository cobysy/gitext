<script setup lang="ts">
/**
 * Which parent of merge for operation (-m n). Merge has multiple parents.
 * Radios write no CSS, keep -m from argv for non-merge.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { formatCommitDate } from '@renderer/format.js';
import type { RevisionSummary } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';

/** 1-based, as `-m` counts. Null when the commit is not a merge. */
const model = defineModel<number | null>({ required: true });

const props = withDefaults(
  defineProps<{
    /** The commit being cherry-picked or reverted. */
    sha: string;
    /** What the chosen parent means for this verb: the two are not the same sentence. */
    hint?: string;
  }>(),
  { hint: '' }
);

const repo = useRepoStore();
const settings = useSettingsStore();

const parents = ref<RevisionSummary[]>([]);

/** One parent is an ordinary commit; none is a root commit. Neither takes `-m`. */
const isMerge = computed(() => parents.value.length > 1);

const options = computed<RadioOption[]>(() =>
  parents.value.map((parent, index) => ({
    value: String(index + 1),
    label: `${index + 1} · ${parent.subject}`,
    hint: `${parent.shortSha} · ${parent.author} · ${formatCommitDate(parent.date, settings.settings.dateFormat)}`
  }))
);

/** `FormRadioGroup` models a string; `-m` takes a number. The seam is here, once. */
const choice = computed<string>({
  get: () =>
  {
    if (model.value === null)
    {
      return '';
    }
    else
    {
      return String(model.value);
    }
  },
  set: (value) =>
  {
    if (value)
    {
      model.value = Number(value);
    }
    else
    {
      model.value = null;
    }
  }
});

watch(
  () => props.sha,
  async (sha) =>
  {
    parents.value = [];
    model.value = null;
    const path = repo.repo?.path;
    if (!sha || !path)
    {
      return;
    }

    const found = await api['repo:parents'](path, sha);
    // The operand can change while git is answering.
    if (props.sha !== sha)
    {
      return;
    }
    parents.value = found;
    // The first parent is the branch the merge landed on, which is what is wanted almost
    // every time. Still an explicit choice on screen, because the other one is a different
    // change entirely.
    if (found.length > 1)
    {
      model.value = 1;
    }
    else
    {
      model.value = null;
    }
  },
  { immediate: true }
);
</script>

<template>
  <FormGroup v-if="isMerge" label="Mainline parent">
    <p v-if="props.hint" class="hint">{{ props.hint }}</p>
    <FormRadioGroup v-model="choice" :options="options" />
  </FormGroup>
</template>
