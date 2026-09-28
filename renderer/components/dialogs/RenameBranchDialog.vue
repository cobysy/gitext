<script setup lang="ts">
/**
 * Rename a branch, the name tidied as it is in Create Branch. Note: `git branch -m`
 * keeps the upstream pointing to the old remote branch, which is usually wanted but
 * a surprise if unsaid.
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildRenameBranchArgs } from '@renderer/model/args/branch.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useBranchNameField } from '@renderer/composables/useBranchNameField.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';
import { REF_KIND_BRANCH } from '@shared/types.js';

const props = defineProps<{ branchName: string }>();
const emit = defineEmits<{ close: [] }>();


const repo = useRepoStore();
const objects = useRepoObjectsStore();
const { busy, error, run } = useDialog();

/** Read-only field, but FormText requires a ref for v-model. */
const currentName = ref(props.branchName);
// Empty, not the current name: prefilling with what it already is opened the dialog with
// a dead primary and "Enter a different name" under it. The current name is shown above
// and stands in as the placeholder, so nothing is lost by starting from a clear field.
const { typed: newName, name: tidied, hint: nameHint, commit: normalise } = useBranchNameField();

const upstream = computed(
  () =>
    objects.refs.find(
      (entry) => entry.kind === REF_KIND_BRANCH && entry.name === props.branchName
    )?.upstream ?? null
);

const collides = computed(() =>
  objects.refs.some(
    (entry) =>
      entry.kind === REF_KIND_BRANCH && entry.name === tidied.value && entry.name !== props.branchName
  )
);

const argv = computed(() =>
{
  if (tidied.value && tidied.value !== props.branchName)
  {
    return buildRenameBranchArgs(props.branchName, tidied.value);
  }
  else
  {
    return [];
  }
}
);

async function rename(): Promise<void>
{
  if (!argv.value.length || busy.value)
  {
    return;
  }
  error.value = '';

  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  if (!(await api['repo:validBranchName'](path, tidied.value)))
  {
    error.value = `'${tidied.value}' is not a valid branch name.`;
    return;
  }

  await run(argv.value, REFS);
}
</script>

<template>
  <DialogFrame title="Rename Branch" @close="emit('close')">
    <div class="form">
      <FormText v-model="currentName" label="Current name" readonly />
      <FormText
        v-model="newName"
        label="New name"
        :hint="nameHint"
        @blur="normalise"
       :placeholder="currentName"/>

      <p v-if="collides" class="warn">A branch called {{ tidied }} already exists.</p>
      <p v-else-if="upstream" class="hint">
        It keeps tracking <code>{{ upstream }}</code>: the remote branch is not renamed.
      </p>

      <CommandPreview :argv="argv" placeholder="Enter a different name" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || collides || busy" @click="rename">
        {{ busy ? 'Renaming…' : 'Rename' }}
      </button>
    </template>
  </DialogFrame>
</template>
