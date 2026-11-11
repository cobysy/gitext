<script setup lang="ts">
/**
 * Deleting local branches (batch operation).
 * `-d` refuses unmerged branches one at a time; show which ones would require `-D`.
 */

import { computed, ref } from 'vue';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useBranchDeletion } from '@renderer/composables/useBranchDeletion.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DeleteButton from '@renderer/components/ui/DeleteButton.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormCheckList from '@renderer/components/ui/FormCheckList.vue';
import ForceDeleteBranches from '@renderer/components/dialogs/parts/ForceDeleteBranches.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';
import { REF_KIND_BRANCH } from '@shared/types.js';

const props = defineProps<{
  branchName?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const { busy, error, run } = useDialog();

// Set, not Record of booleans: avoids undefined index access with checkboxes.
let initialChosen: string[];
if (props.branchName)
{
  initialChosen = [props.branchName];
}
else
{
  initialChosen = [];
}
const chosen = ref<ReadonlySet<string>>(new Set(initialChosen));

function choose(name: string, on: boolean): void
{
  const next = new Set(chosen.value);
  if (on)
  {
    next.add(name);
  }
  else
  {
    next.delete(name);
  }
  chosen.value = next;
}

// Every local branch except the currently checked-out one (git refuses to delete it anyway).
const candidates = computed(() =>
  objects.refs.filter((entry) => entry.kind === REF_KIND_BRANCH && !entry.isCurrent)
);

const selected = computed(() =>
  candidates.value.filter((entry) => chosen.value.has(entry.name))
);

const { force, unmerged, argv, wouldBeRefused, deleteLabel, isMerged } = useBranchDeletion(selected);

const currentBranch = computed(() => repo.repo?.branch ?? null);
</script>

<template>
  <DialogFrame title="Delete Branches" @close="emit('close')">
    <div class="form">
      <p v-if="!candidates.length" class="placeholder">
        There is nothing to delete:
        <template v-if="currentBranch">
          <code>{{ currentBranch }}</code> is the only local branch.
        </template>
        <template v-else>no local branches.</template>
      </p>

      <FormCheckList v-else>
        <FormCheck
          v-for="entry in candidates"
          :key="entry.fullName"
          :model-value="chosen.has(entry.name)"
          :label="`\`${entry.name}\``"
          @update:model-value="(on: boolean) => choose(entry.name, on)"
          :hint="
            isMerged(entry)
              ? undefined
              : 'Not merged, its commits become unreachable.'
          "
        />
      </FormCheckList>

      <ForceDeleteBranches v-model="force" :unmerged="unmerged" />

      <CommandPreview :argv="argv" placeholder="Pick at least one branch" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <DeleteButton
        :class="force ? 'danger' : 'primary'"
        :disabled="busy || !selected.length || wouldBeRefused"
        @click="run(argv, REFS)"
      >
        {{ busy ? 'Deleting…' : deleteLabel }}
      </DeleteButton>
    </template>
  </DialogFrame>
</template>
