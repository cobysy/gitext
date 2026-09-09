<script setup lang="ts">
/**
 * Replay a commit onto the current branch. A merge commit needs `-m <mainline>`; `-x`
 * records where it came from. The commit is *choosable*: the dialog opens on whatever
 * the grid was pointing at, but the field takes any revision expression, so
 * `origin/main~2` is one edit rather than a cancel and a hunt.
 */

import { computed, ref } from 'vue';
import { buildCherryPickArgs } from '@renderer/model/args/cherrypick.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import CommitPicker from './parts/CommitPicker.vue';
import MainlinePicker from './parts/MainlinePicker.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';

const props = defineProps<{ sha: string }>();
const emit = defineEmits<{ close: [] }>();

const settings = useSettingsStore();
const { busy, error, run } = useDialog();

const revision = ref(props.sha);
const mainline = ref<number | null>(null);
// Both persist, as `CommitAutomaticallyAfterCherryPick` and
// `AddCommitReferenceToCherryPick` do.
const autoCommit = ref(settings.settings.cherryPickAutoCommit);
const addReference = ref(settings.settings.cherryPickAddReference);

const argv = computed(() =>
  buildCherryPickArgs({
    sha: revision.value.trim(),
    autoCommit: autoCommit.value,
    addReference: addReference.value,
    mainline: mainline.value
  })
);

async function pick(): Promise<void>
{
  await settings.patch({
    cherryPickAutoCommit: autoCommit.value,
    cherryPickAddReference: addReference.value
  });
  // A cherry-pick that does not apply cleanly exits non-zero and leaves the sequencer
  // running: that is the operation having happened, so the window closes and the resolver
  // opens rather than the dialog reporting git's stderr as a refusal.
  await run(argv.value, HISTORY_MOVE, { allowConflicts: true });
}
</script>

<template>
  <DialogFrame title="Cherry-pick Commit" @close="emit('close')">
    <div class="form">
      <CommitPicker v-model="revision" label="Commit" summary-label="Which is" />

      <MainlinePicker
        v-model="mainline"
        :sha="revision"
        hint="A merge: the changes are measured against the parent you pick."
      />

      <FormCheck
        v-model="autoCommit"
        label="Commit the result"
        hint="Off is `--no-commit`: the changes land staged."
      />
      <FormCheck
        v-model="addReference"
        label="Reference the original commit"
        hint="`-x`: notes the original commit in the message."
      />

      <CommandPreview :argv="argv" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="pick">
        {{ busy ? 'Cherry-picking…' : 'Cherry-pick' }}
      </button>
    </template>
  </DialogFrame>
</template>
