<script setup lang="ts">
/**
 * Revert dialog: separate from cherry-pick (no -x, doesn't remember, has message carry-across).
 * Mainline picker needed: reverting a merge undoes relative to one parent.
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { buildRevertArgs } from '@renderer/model/args/revert.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import CommitPicker from './parts/CommitPicker.vue';
import MainlinePicker from './parts/MainlinePicker.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';
import { MERGE_MSG_FILE } from '@shared/types.js';


const props = defineProps<{ sha: string }>();
const emit = defineEmits<{ close: [] }>();

const { busy, error, perform } = useDialog();

const revision = ref(props.sha);
const mainline = ref<number | null>(null);
const autoCommit = ref(true);

const argv = computed(() =>
  buildRevertArgs({
    sha: revision.value.trim(),
    autoCommit: autoCommit.value,
    mainline: mainline.value
  })
);

async function revert(): Promise<void>
{
  await perform(
    'Reverting',
    async (repoPath) =>
    {
      // git *overwrites* MERGE_MSG when a revert stops before committing, so a message
      // somebody was already composing has to be carried across the command. The read has
      // to happen before the run: afterwards there is nothing left to read.
      const existing = (await api['git:readMessageFile'](repoPath, MERGE_MSG_FILE)).trim();
      try
      {
        await runConsoleSteps(repoPath, [{ label: 'Reverting', argv: argv.value }], HISTORY_MOVE);
      }
      finally
      {
        // In a `finally` because the case that most needs the old message back is the one
        // where the revert stopped: a conflict is when a half-written commit message is
        // most likely to be sitting there.
        if (existing)
        {
          const written = (await api['git:readMessageFile'](repoPath, MERGE_MSG_FILE)).trim();
          let combined;
          if (written)
          {
            combined = `${existing}\n\n${written}`;
          }
          else
          {
            combined = existing;
          }
          await api['git:writeMessageFile'](repoPath, MERGE_MSG_FILE, combined);
        }
      }
    },
    { allowConflicts: true }
  );
}
</script>

<template>
  <DialogFrame title="Revert Commit" @close="emit('close')">
    <div class="form">
      <CommitPicker v-model="revision" label="Commit" summary-label="Which is" />

      <MainlinePicker
        v-model="mainline"
        :sha="revision"
        hint="A merge: parent 1 undoes the merged-in work."
      />

      <FormCheck
        v-model="autoCommit"
        label="Commit the reversal"
        hint="Off is `--no-commit`: the undo lands staged."
      />

      <CommandPreview :argv="argv" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="revert">
        {{ busy ? 'Reverting…' : 'Revert' }}
      </button>
    </template>
  </DialogFrame>
</template>
