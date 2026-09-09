<script setup lang="ts">
/**
 * Deleting local branches (batch operation).
 * `-d` refuses unmerged branches one at a time; show which ones would require `-D`.
 */

import { computed, onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildDeleteBranchArgs } from '@renderer/model/args/branch.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormCheckList from '@renderer/components/ui/FormCheckList.vue';
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
const force = ref(false);

// Every local branch except the currently checked-out one (git refuses to delete it anyway).
const candidates = computed(() =>
  objects.refs.filter((entry) => entry.kind === REF_KIND_BRANCH && !entry.isCurrent)
);

const selected = computed(() =>
  candidates.value.filter((entry) => chosen.value.has(entry.name))
);

// Branches already in HEAD. Read here, not from store: dialogs have no grid for selection.
const mergedIntoHead = ref<ReadonlySet<string>>(new Set());

const unmerged = computed(() =>
  selected.value.filter((entry) => !mergedIntoHead.value.has(entry.fullName))
);

const argv = computed(() =>
  buildDeleteBranchArgs(
    selected.value.map((entry) => entry.name),
    force.value
  )
);

/**
 * The command as built would be refused by git.
 *
 * An unmerged branch is ticked and `--force` is not, so `git branch --delete` will fail.
 * The dialog already knows this: it says so in the checkbox hint. Offering an enabled
 * button that cannot work is the preview promising something it will not deliver, so the
 * primary waits until the form asks for something git will accept.
 */
const wouldBeRefused = computed(() => unmerged.value.length > 0 && !force.value);

const currentBranch = computed(() => repo.repo?.branch ?? null);

/**
 * What the primary promises. A bare count reads as a stray digit when it is `1`: the
 * number is worth saying once there is a number to say, and what it counts with it.
 */
const deleteLabel = computed(() =>
{
  if (selected.value.length > 1)
  {
    return `Delete ${selected.value.length} Branches`;
  }
  return 'Delete Branch';
});

onMounted(async () =>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  try
  {
    mergedIntoHead.value = new Set(await api['refs:merged'](path, 'HEAD'));
  }
  catch
  {
    // Empty set errs towards showing the unmerged warning.
    mergedIntoHead.value = new Set();
  }
});
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
            mergedIntoHead.has(entry.fullName)
              ? undefined
              : 'Not merged, its commits become unreachable.'
          "
        />
      </FormCheckList>

      <FormCheck
        v-model="force"
        label="Delete even the ones that are not merged"
        :disabled="!unmerged.length"
        :hint="
          unmerged.length
            ? `\`--force\`: ${unmerged.map((entry) => `\`${entry.name}\``).join(', ')} would otherwise be refused.`
            : 'Everything selected is already merged.'
        "
      />

      <DangerNote v-if="force && unmerged.length">
        {{ unmerged.length }}
        {{ unmerged.length === 1 ? 'branch has' : 'branches have' }} commits on no other
        branch. Deleting them leaves those commits reachable only through the reflog.
      </DangerNote>

      <CommandPreview :argv="argv" placeholder="Pick at least one branch" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button
        :class="force ? 'danger' : 'primary'"
        :disabled="busy || !selected.length || wouldBeRefused"
        @click="run(argv, REFS)"
      >
        {{ busy ? 'Deleting…' : deleteLabel }}
      </button>
    </template>
  </DialogFrame>
</template>
