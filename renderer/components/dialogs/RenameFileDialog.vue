<script setup lang="ts">
/** Rename/move file via `git mv` (records rename, not delete+add, for readable diff). */

import { computed, onMounted, ref } from 'vue';
import { buildMoveArgs } from '@renderer/model/args/file.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const props = defineProps<{ filePath: string }>();
const emit = defineEmits<{ close: [] }>();

const staging = useStagingStore();
const { busy, error, run } = useDialog();

/** Read-only, but a field's value is still state: `FormText` binds with `v-model`. */
const from = ref(props.filePath);
const target = ref(props.filePath);
const targetField = ref<InstanceType<typeof FormText> | null>(null);

const changed = computed(() => target.value.trim() !== '' && target.value !== props.filePath);

const argv = computed(() => buildMoveArgs(props.filePath, target.value));

async function rename(): Promise<void>
{
  // `git:run` with the argv the preview is drawing, rather than the `file:move` channel
  // that built `mv -- from to` a second time in the main process. One array, one command.
  // `git mv` moves the file on disk and rewrites its index entry.
  if (!(await run(argv.value, ['worktree', 'index'])))
  {
    return;
  }
  // The repository itself is refreshed by `run`; the staging lists are this window's own
  // view of what moved.
  await staging.refresh();
}

onMounted(() =>
{
  // The dialog's own keyboard focuses the first writable field a tick later, which is
  // this one; doing it here first means the selection below survives that no-op focus.
  const input = targetField.value?.input;
  input?.focus();
  // Select the name and leave the directory alone: a rename is far more often a new
  // name in the same folder than a move to a different one.
  const cut = props.filePath.lastIndexOf('/');
  input?.setSelectionRange(cut + 1, props.filePath.length);
});
</script>

<template>
  <DialogFrame title="Rename / Move" @close="emit('close')">
    <div class="form">
      <FormText v-model="from" label="From" readonly />
      <FormText ref="targetField" v-model="target" label="To" />
      <CommandPreview :argv="argv" placeholder="Enter a different path" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!changed || busy" @click="rename">
        {{ busy ? 'Moving…' : 'Rename' }}
      </button>
    </template>
  </DialogFrame>
</template>
