<script setup lang="ts">
/**
 * Create a branch. Changeable commit, name normalization, orphan support.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { buildCreateBranchSteps } from '@renderer/model/args/branch.js';
import { normaliseBranchName } from '@renderer/model/branchName.js';
import { suggestedBranchNameAt } from '@renderer/model/localBranchName.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommitPicker from '@renderer/components/dialogs/parts/CommitPicker.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';

const props = defineProps<{
  /** Where the branch starts, from whatever opened the dialog. `HEAD` when nothing did. */
  startPoint?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const settings = useSettingsStore();
const { busy, error, runSteps } = useDialog();

const name = ref('');
const startPoint = ref(props.startPoint ?? 'HEAD');
const checkout = ref(true);
const orphan = ref(false);
const showOrphan = ref(false);
const clearWorkingDirectory = ref(false);

/**
 * A repository with no commits can only have an orphan branch: there is nothing to start
 * from, so both boxes lock to that.
 */
const unborn = computed(() => repo.repo !== null && repo.repo.head === null);

watch(
  unborn,
  (value) =>
  {
    if (!value)
    {
      return;
    }
    orphan.value = true;
    checkout.value = true;
  },
  { immediate: true }
);

// An orphan is always a checkout: there is no way to create one without moving to it.
watch(orphan, (value) =>
{
  if (value)
  {
    checkout.value = true;
  }
  else
  {
    clearWorkingDirectory.value = false;
  }
});

/**
 * Prefill from a ref already on the starting point, branch before tag.
 *
 * Only while the field has not been typed into: re-suggesting over something the user
 * wrote because they changed the starting point afterwards would be the dialog arguing.
 */
const nameTouched = ref(false);
watch(
  startPoint,
  (rev) =>
  {
    if (nameTouched.value || !rev)
    {
      return;
    }
    const suggestion = suggestedBranchNameAt(rev, objects.refs);
    if (suggestion)
    {
      name.value = suggestion;
    }
  },
  { immediate: true }
);

/**
 * Normalised when the field is left, not while it is being typed in.
 *
 * On every keystroke it would fight the caret: typing `fix: x` would become `fix_` before
 * the space was reached.
 */
function normalise(): void
{
  if (!settings.settings.normaliseBranchNames)
  {
    return;
  }
  name.value = normaliseBranchName(name.value, {
    token: settings.settings.normaliseBranchSymbol
  });
}

const trimmed = computed(() => name.value.trim());

const steps = computed(() =>
{
  // An unborn repository has nothing to start from, and git resolves the orphan against
  // an empty index rather than failing.
  let startPointArg: string | undefined;
  if (unborn.value)
  {
    startPointArg = undefined;
  }
  else
  {
    startPointArg = startPoint.value;
  }
  return buildCreateBranchSteps({
    name: trimmed.value,
    startPoint: startPointArg,
    checkout: checkout.value,
    orphan: orphan.value,
    clearWorkingDirectory: clearWorkingDirectory.value
  });
}
);

async function create(): Promise<void>
{
  if (!trimmed.value || busy.value)
  {
    return;
  }
  error.value = '';

  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  // git's own rules, asked of git: normalising covers the common typo, not every case.
  if (!(await api['repo:validBranchName'](path, trimmed.value)))
  {
    error.value = `'${trimmed.value}' is not a valid branch name.`;
    return;
  }

  // Creating a branch adds a ref; `checkout: true` also moves HEAD, and the
  // clear-working-directory option rewrites the tree.
  await runSteps(steps.value, [...REFS, 'head', 'worktree']);
}
</script>

<template>
  <DialogFrame title="Create Branch" @close="emit('close')">
    <div class="form">
      <FormText
        v-model="name"
        label="Branch name"
        placeholder="feature/my-branch"
        :hint="
          settings.settings.normaliseBranchNames
            ? 'Tidied into a name git accepts when you leave the field.'
            : undefined
        "
        @input="nameTouched = true"
        @blur="normalise"
      />

      <CommitPicker v-if="!unborn" v-model="startPoint" :disabled="orphan" />
      <DangerNote v-else tone="warning">
        No commits yet, so the only branch it can have is an orphan.
      </DangerNote>

      <FormCheck
        v-model="checkout"
        label="Check the new branch out"
        :disabled="orphan"
        hint="`checkout -b`. An orphan is always checked out."
      />

      <!-- Folded away in a repository that has commits: an orphan branch is a rare thing
           to want, and two checkboxes about starting a history from nothing sat at the
           same weight as the branch name. Not offered at all when the repository is unborn,
           where every branch is an orphan and there is nothing to choose. -->
      <FormDisclosure
        v-if="!unborn"
        v-model="showOrphan"
        label="Orphan branch"
        :summary="orphan ? '--orphan' : ''"
      >
        <FormCheck
          v-model="orphan"
          label="Start a new history"
          hint="`--orphan`: a history with no parent."
        />
        <FormCheck
          v-model="clearWorkingDirectory"
          label="Empty the working directory and index"
          :disabled="!orphan"
          hint="`rm -r .`: otherwise the old files start staged."
        />
      </FormDisclosure>

      <CommandPreview :steps="steps" placeholder="Enter a branch name first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!trimmed || busy" @click="create">
        {{ busy ? 'Creating…' : 'Create Branch' }}
      </button>
    </template>
  </DialogFrame>
</template>
