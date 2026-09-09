<script setup lang="ts">
/**
 * Checkout commit (not branch): no picker (grid names it), detached HEAD warning.
 * Local changes group (not just Force): git refuses dirty tree, --force is one of four options.
 */

import { computed } from 'vue';
import { buildCheckoutSteps } from '@renderer/model/args/checkout.js';
import { useCheckoutLocalChanges } from '@renderer/composables/useCheckoutLocalChanges.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import CommitSummary from '@renderer/components/dialogs/parts/CommitSummary.vue';
import LocalChangesChoice from '@renderer/components/dialogs/parts/LocalChangesChoice.vue';
import RememberChoice from '@renderer/components/dialogs/parts/RememberChoice.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const props = defineProps<{
  /** The revision to check out: a SHA from the grid, a tag from the left panel. */
  gitRef?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const settingsStore = useSettingsStore();
const { busy, error, run, runSteps, close } = useDialog();

const rev = computed(() => props.gitRef ?? '');

const {
  dirty,
  localChanges,
  rememberLocalChanges,
  branchMode,
  wipBranchName,
  canRemember,
  flagLocalChanges,
  changesBranch,
  willStash,
  invalidates,
  rememberIfWanted,
  popStashIfWanted
} = useCheckoutLocalChanges({ repo, objects, settings: settingsStore });

const steps = computed(() =>
{
  if (rev.value)
  {
    return buildCheckoutSteps({
      ref: rev.value,
      localChanges: flagLocalChanges.value,
      stash: willStash.value,
      stashUntracked: settingsStore.settings.autoStashUntracked,
      branch: changesBranch.value
    });
  }
  else
  {
    return [];
  }
}
);

async function checkout(): Promise<void>
{
  if (!rev.value || busy.value)
  {
    return;
  }
  // Every branch strategy creates one, so an empty name is a form still being filled in.
  if (changesBranch.value && !changesBranch.value.name)
  {
    return;
  }

  const stashed = willStash.value;
  const ok = await runSteps(steps.value, invalidates.value, { close: !stashed });
  if (!ok)
  {
    return;
  }

  await rememberIfWanted();

  if (!stashed)
  {
    return;
  }

  await popStashIfWanted(run, close);
}
</script>

<template>
  <DialogFrame title="Checkout Revision" @close="emit('close')">
    <div class="form">
      <CommitSummary :rev="rev" label="Check out" />

      <!-- The whole reason this dialog is not the branch one: what a person is about to
           end up in, said before they press the button rather than by git afterwards. -->
      <DangerNote tone="warning">
        This leaves you on a detached <code>HEAD</code>: a commit made here belongs to no
        branch.
      </DangerNote>

      <LocalChangesChoice
        v-model="localChanges"
        v-model:branch-mode="branchMode"
        v-model:branch-name="wipBranchName"
        :dirty="dirty"
        :target="rev"
      />
      <RememberChoice
        v-if="dirty"
        v-model="rememberLocalChanges"
        what="this choice for local changes"
        :disabled="!canRemember"
      />

      <CommandPreview :steps="steps" placeholder="No revision to check out" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!rev || busy" @click="checkout">
        {{ busy ? 'Checking out…' : 'Checkout' }}
      </button>
    </template>
  </DialogFrame>
</template>
