<script setup lang="ts">
/**
 * Export commits to .patch files. No grid in a dialog, so range is two expressions
 * with summaries. Uses `--root` for the oldest commit: an empty field would mean "from HEAD",
 * exporting nothing silently.
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildFormatPatchArgs } from '@renderer/model/args/patch.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormNumber from '@renderer/components/ui/FormNumber.vue';
import FormPathText from '@renderer/components/ui/FormPathText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import CommitPicker from './parts/CommitPicker.vue';
import { READS } from '@shared/invalidation.js';

const props = withDefaults(
  defineProps<{ from?: string; to?: string }>(),
  { from: '', to: 'HEAD' }
);
const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const { busy, error, run, perform } = useDialog();

const from = ref(props.from);
const to = ref(props.to);
const output = ref('');
const wholeBranch = ref(props.from === '');
const numbered = ref(false);
const startNumber = ref<number | null>(1);

const argv = computed(() =>
{
  let fromArg: string;
  if (wholeBranch.value)
  {
    fromArg = '';
  }
  else
  {
    fromArg = from.value;
  }
  let startNumberArg: number | null;
  if (numbered.value)
  {
    startNumberArg = startNumber.value;
  }
  else
  {
    startNumberArg = null;
  }
  return buildFormatPatchArgs({
    from: fromArg,
    to: to.value,
    output: output.value,
    startNumber: startNumberArg
  });
});

async function chooseDirectory(): Promise<void>
{
  await perform(
    'Choosing a folder',
    async () =>
    {
      const chosen = await api['file:chooseDirectory'](repo.repo?.path ?? '');
      if (chosen)
      {
        output.value = chosen;
      }
    },
    { close: false, refresh: false }
  );
}

/** Files land outside the repo, so no refresh needed. */
async function format(): Promise<void>
{
  await run(argv.value, READS, { refresh: false });
}
</script>

<template>
  <DialogFrame title="Format Patch" @close="emit('close')">
    <div class="form">
      <FormCheck
        v-model="wholeBranch"
        label="Everything on the branch"
        hint="`--root`: from the branch's first commit."
      />

      <CommitPicker v-if="!wholeBranch" v-model="from" label="After" summary-label="Which is" />
      <CommitPicker v-model="to" label="Up to and including" summary-label="Which is" />

      <FormPathText
        v-model="output"
        label="Write to"
        placeholder="A folder for the .patch files"
        browse-label="Choose a folder…"
        :disabled="busy"
        @browse="chooseDirectory"
      />

      <FormCheck
        v-model="numbered"
        label="Start numbering the files at"
        hint="`--start-number`"
      />
      <FormNumber
        v-if="numbered"
        v-model="startNumber"
        label="First number"
        :min="1"
      />

      <CommandPreview :argv="argv" placeholder="Choose a folder to write to" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="format">
        {{ busy ? 'Writing…' : 'Format Patch' }}
      </button>
    </template>
  </DialogFrame>
</template>
