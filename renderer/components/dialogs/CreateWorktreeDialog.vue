<script setup lang="ts">
/**
 * Second working directory for same repository. Path is relative; links
 * move together. Branch: git won't put same branch in two worktrees.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { REF_KIND_BRANCH } from '@shared/types.js';
import {
  buildWorktreeAddArgs,
  type WorktreeCheckout
} from '@renderer/model/args/worktree.js';
import { toRepoRelative } from '@renderer/model/paths.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormPathText from '@renderer/components/ui/FormPathText.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import CommitPicker from './parts/CommitPicker.vue';
import { HEAD_REF } from '@renderer/model/sha.js';

const props = withDefaults(defineProps<{ gitRef?: string }>(), { gitRef: '' });
const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const { busy, error, run, perform } = useDialog();

// Worktree checkout modes
const CHECKOUT_NEW_BRANCH = 'new-branch';
const CHECKOUT_EXISTING_BRANCH = 'existing-branch';
const CHECKOUT_DETACH = 'detach';

// Ref kind

const CONFIG_KEY_RELATIVE_PATHS = 'worktree.useRelativePaths';

const directory = ref('');
const checkout = ref<WorktreeCheckout>(CHECKOUT_NEW_BRANCH);
const newBranch = ref('');
const existingBranch = ref(props.gitRef);
const startPoint = ref(HEAD_REF);
const force = ref(false);
const openAfter = ref(true);
/** True when the repository has not set the key, so writing it is a decision. */
const setRelativePaths = ref(false);

/** Branches not already checked out somewhere: git refuses to put one in two worktrees. */
const availableBranches = computed(() =>
{
  const taken = new Set(
    objects.worktrees.map((entry) => entry.branch).filter((name): name is string => !!name)
  );
  return objects.refs
    .filter((entry) => entry.kind === REF_KIND_BRANCH && !taken.has(entry.name))
    .map((entry) => ({ value: entry.name, label: entry.name }));
});

const checkoutOptions = computed<readonly RadioOption[]>(() =>
{
  let existingHint: string;
  if (availableBranches.value.length)
  {
    existingHint = 'Only branches not checked out anywhere.';
  }
  else
  {
    existingHint = 'Every branch is already checked out somewhere.';
  }
  return [
    {
      value: CHECKOUT_NEW_BRANCH,
      label: 'A new branch',
      hint: '`-b`, a new branch to work on here.'
    },
    {
      value: CHECKOUT_EXISTING_BRANCH,
      label: 'An existing branch',
      hint: existingHint,
      disabled: availableBranches.value.length === 0
    },
    {
      value: CHECKOUT_DETACH,
      label: 'A detached `HEAD` at some revision',
      hint: '`--detach`, for reading a commit rather than working on one.'
    }
  ];
});

/** Relative to the repository: as anyone would type it. */
const relativePath = computed(() =>
{
  if (repo.repo && directory.value)
  {
    return toRepoRelative(repo.repo.path, directory.value);
  }
  else
  {
    return directory.value;
  }
}
);

const argv = computed(() =>
{
  let branch: string;
  if (checkout.value === CHECKOUT_NEW_BRANCH)
  {
    branch = newBranch.value;
  }
  else
  {
    branch = existingBranch.value;
  }
  return buildWorktreeAddArgs({
    path: relativePath.value,
    checkout: checkout.value,
    branch,
    startPoint: startPoint.value,
    force: force.value,
    setRelativePaths: setRelativePaths.value
  });
});

/** The repo path to suggest a directory under, or null when a suggestion isn't wanted. */
function directorySuggestionTargetOf(
  checkout: WorktreeCheckout,
  repoPath: string | undefined,
  directory: string
): string | null
{
  if (checkout === CHECKOUT_NEW_BRANCH && repoPath && !directory)
  {
    return repoPath;
  }
  else
  {
    return null;
  }
}

/** The directory the new worktree will be created in, suggested from the branch name. */
watch([newBranch, checkout], () =>
{
  const repoPath = directorySuggestionTargetOf(checkout.value, repo.repo?.path, directory.value);
  if (!repoPath)
  {
    return;
  }
  const name = newBranch.value.trim().replace(/\//g, '-');
  if (name)
  {
    directory.value = `${repoPath}-${name}`;
  }
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
        directory.value = chosen;
      }
    },
    { close: false, refresh: false }
  );
}

async function create(): Promise<void>
{
  const target = directory.value;
  // Held open until the run has succeeded, so "open it" acts on a worktree that exists.
  if (!(await run(argv.value, ['worktrees', 'refs'], { close: false })))
  {
    return;
  }
  if (openAfter.value)
  {
    // The repository window opens it, not this one: a dialog has a store of its own and
    // no grid, so opening it here would point a closing window at a new repository.
    await api['repo:openHere'](target);
  }
  emit('close');
}

onMounted(async () =>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  const config = await api['repo:config'](path, [CONFIG_KEY_RELATIVE_PATHS]);
  // Only when unset: writing a value the repository already has is a `-c` in the command
  // log that reads as a decision nobody made.
  setRelativePaths.value = config[CONFIG_KEY_RELATIVE_PATHS] === undefined;
  if (!existingBranch.value)
  {
    existingBranch.value = availableBranches.value[0]?.value ?? '';
  }
});
</script>

<template>
  <DialogFrame title="Create Worktree" @close="emit('close')">
    <div class="form">
      <FormPathText
        v-model="directory"
        label="Folder"
        placeholder="Where the new working directory goes"
        browse-label="Choose a folder…"
        :disabled="busy"
        :hint="
          relativePath && relativePath !== directory
            ? `Written as \`${relativePath}\`, relative to the repository.`
            : 'A folder that does not exist yet, or an empty one.'
        "
        @browse="chooseDirectory"
      />

      <FormGroup label="What to check out in it">
        <FormRadioGroup v-model="checkout" :options="checkoutOptions" />

        <FormText
          v-if="checkout === CHECKOUT_NEW_BRANCH"
          v-model="newBranch"
          label="Branch name"
          placeholder="feature/the-thing"
        />
        <FormSelect
          v-else-if="checkout === CHECKOUT_EXISTING_BRANCH"
          v-model="existingBranch"
          label="Branch"
          :options="availableBranches"
          placeholder="Pick a branch…"
        />

        <CommitPicker
          v-if="checkout !== CHECKOUT_EXISTING_BRANCH"
          v-model="startPoint"
          :label="checkout === CHECKOUT_DETACH ? 'At' : 'Starting from'"
          summary-label="Which is"
        />
      </FormGroup>

      <FormCheck
        v-model="force"
        label="Create it even if the branch is checked out elsewhere"
        hint="`--force`: two worktrees on one branch disagree."
      />
      <FormCheck
        v-model="openAfter"
        label="Open it when it is created"
        hint="Switches this window to the new working directory."
      />

      <CommandPreview :argv="argv" placeholder="Choose a folder and what to check out" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="create">
        {{ busy ? 'Creating…' : 'Create Worktree' }}
      </button>
    </template>
  </DialogFrame>
</template>
