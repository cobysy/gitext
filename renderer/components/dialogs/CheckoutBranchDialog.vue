<script setup lang="ts">
/**
 * Checking out a branch, past a ref, `--detach` and `-f` alone:
 *
 * - **Local changes.** git refuses a dirty tree. The four options here are the four
 *   things a person does next; *Stash* is a `stash push` in front of the checkout with
 *   an offer to pop it after.
 * - **A remote branch is a different question.** `git checkout origin/x` leaves a
 *   detached HEAD, almost never meant. The panel offers three answers: stay detached,
 *   create-or-reset the tracking branch, or create one beside it under its own name.
 * - **How far away is it.** Ahead/behind against HEAD, turning a branch name into a decision.
 *
 * The operand comes from the payload; whether it's a *remote* branch is read from the
 * ref list instead, so it can't disagree with what the picker shows.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { REF_KIND_BRANCH, REF_KIND_REMOTE } from '@shared/types.js';
import type { RepoFacet } from '@shared/invalidation.js';
import {
  buildCheckoutSteps,
  checkoutCreatesBranch,
  type NewBranchMode
} from '@renderer/model/args/checkout.js';
import { localTrackingBranchName, suggestedLocalBranchName } from '@renderer/model/localBranchName.js';
import { useCheckoutLocalChanges } from '@renderer/composables/useCheckoutLocalChanges.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, {
  type RadioOption
} from '@renderer/components/ui/FormRadioGroup.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import LocalChangesChoice from '@renderer/components/dialogs/parts/LocalChangesChoice.vue';
import RefPicker from '@renderer/components/dialogs/parts/RefPicker.vue';
import RememberChoice from '@renderer/components/dialogs/parts/RememberChoice.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const props = defineProps<{
  /** The ref this was opened about. Absent from the menu bar, which opens the picker. */
  gitRef?: string;
  /**
   * The branch to open *on* when there's no operand: the one the grid is sitting on. A
   * guess, so the picker stays a picker; `gitRef` is the opposite case and stays read-only.
   */
  suggestedRef?: string;
}>();

const emit = defineEmits<{ close: [] }>();

// Source types
const SOURCE_LOCAL = 'local';
const SOURCE_REMOTE = 'remote';

// New branch modes
/** The ref list, which gains a branch whenever this dialog names one. */
const FACET_REFS = 'refs';

const NEW_BRANCH_NONE = 'none';
const NEW_BRANCH_CREATE = 'create';
const NEW_BRANCH_RESET = 'reset';

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const settingsStore = useSettingsStore();
const ui = useUiStore();
const { busy, error, run, runSteps, close } = useDialog();

// ── What is being checked out ────────────────────────────────────────────────

const selectedRef = ref(props.gitRef ?? props.suggestedRef ?? '');

/**
 * Which list the picker offers. Only shown when opened without a ref. Seeded from
 * what's already selected, not always `'local'`: a suggestion the radio contradicts
 * would show a list the chosen branch isn't in. Read once at setup.
 */
let initialSource: typeof SOURCE_LOCAL | typeof SOURCE_REMOTE;
if (objects.refs.find((entry) => entry.name === selectedRef.value)?.kind === REF_KIND_REMOTE)
{
  initialSource = SOURCE_REMOTE;
}
else
{
  initialSource = SOURCE_LOCAL;
}
const source = ref<typeof SOURCE_LOCAL | typeof SOURCE_REMOTE>(initialSource);

const localBranches = computed(() => objects.refs.filter((ref) => ref.kind === REF_KIND_BRANCH));
const remoteNames = computed(() => objects.remotes.map((remote) => remote.name));

/** Whether the selected ref is a remote branch: read from the ref list, not a prop, so it's the same answer the picker shows. */
const isRemote = computed(
  () => objects.refs.find((ref) => ref.name === selectedRef.value)?.kind === REF_KIND_REMOTE
);

// The picker's radio only decides which list to *offer*; once a ref is chosen, what it
// is decides everything else. Changing the radio clears the choice.
watch(source, () =>
{
  if (!props.gitRef)
  {
    selectedRef.value = '';
  }
});

// ── The remote-branch panel ──────────────────────────────────────────────────

const newBranchMode = ref<NewBranchMode>(NEW_BRANCH_RESET);
const customName = ref('');

/** The local branch this remote branch corresponds to, tracking config first. */
const trackingName = computed(() =>
{
  if (isRemote.value)
  {
    return localTrackingBranchName(
      selectedRef.value,
      remoteNames.value,
      localBranches.value.map((ref) => ({ name: ref.name, upstream: ref.upstream }))
    );
  }
  else
  {
    return '';
  }
}
);

const trackingBranchExists = computed(() =>
  localBranches.value.some((ref) => ref.name === trackingName.value)
);

/** `-B` on a branch that exists is a reset; on one that does not it is a creation. */
const resetLabel = computed(() =>
{
  if (trackingBranchExists.value)
  {
    return `Reset local branch '${trackingName.value}'`;
  }
  else
  {
    return `Create local branch '${trackingName.value}'`;
  }
}
);

// Re-suggested whenever the branch changes, because the suggestion is derived from it.
watch([selectedRef, isRemote], () =>
{
  if (!isRemote.value)
  {
    return;
  }
  customName.value = suggestedLocalBranchName(
    selectedRef.value,
    remoteNames.value,
    localBranches.value.map((ref) => ref.name)
  );
});

const remoteModeOptions = computed<readonly RadioOption[]>(() =>
{
  let resetHint: string;
  if (trackingBranchExists.value)
  {
    resetHint = `\`-B\`: moves \`${trackingName.value}\` to this commit, discarding anything only it had.`;
  }
  else
  {
    resetHint = `\`-B\`: creates \`${trackingName.value}\` here.`;
  }
  return [
    {
      value: NEW_BRANCH_NONE,
      label: 'Check out the commit (detached)',
      hint: 'Detached `HEAD`, commits belong to no branch.'
    },
    {
      value: NEW_BRANCH_RESET,
      label: resetLabel.value,
      hint: resetHint
    },
    {
      value: NEW_BRANCH_CREATE,
      label: 'Create local branch with a different name',
      hint: '`-b` … `--track`'
    }
  ];
});

// ── Uncommitted changes ──────────────────────────────────────────────────────

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

// ── How far away it is ───────────────────────────────────────────────────────

const distance = ref<string>('');

watch(
  selectedRef,
  async (ref) =>
  {
    distance.value = '';
    if (!ref || !settingsStore.settings.repoFactsInDialogs)
    {
      return;
    }
    const path = repo.repo?.path;
    if (!path)
    {
      return;
    }
    const counts = await api['repo:aheadBehind'](path, ref);
    // Still the ref we asked about: the picker can move while git is answering.
    if (selectedRef.value !== ref)
    {
      return;
    }
    if (!counts)
    {
      // Nothing to say rather than a placeholder: the hint is dropped when it is empty.
      distance.value = '';
      return;
    }
    const { ahead, behind } = counts;
    if (ahead === 0 && behind === 0)
    {
      distance.value = 'even with `HEAD`';
    }
    else
    {
      let aheadPart: string;
      if (ahead)
      {
        aheadPart = `${ahead} ahead`;
      }
      else
      {
        aheadPart = '';
      }
      let behindPart: string;
      if (behind)
      {
        behindPart = `${behind} behind`;
      }
      else
      {
        behindPart = '';
      }
      distance.value = [aheadPart, behindPart].filter(Boolean).join(', ');
    }
  },
  { immediate: true }
);

// ── What runs ────────────────────────────────────────────────────────────────

/**
 * Whether a local branch is being named, and therefore whether its name is required and
 * whether the ref list has to be reloaded. One computed for both, since they are the same
 * fact: the rule itself sits beside the argv that creates the branch.
 */
const namesLocalBranch = computed(() =>
  checkoutCreatesBranch(isRemote.value, newBranchMode.value)
);

/**
 * What this checkout invalidates. `useCheckoutLocalChanges` answers for the local-changes
 * half; the ref list is this dialog's to add, since it is the only surface that can turn a
 * checkout into a branch creation. See `checkoutCreatesBranch`.
 */
const checkoutInvalidates = computed<readonly RepoFacet[]>(() =>
{
  if (namesLocalBranch.value)
  {
    return [...invalidates.value, FACET_REFS];
  }
  return invalidates.value;
});

const newBranchName = computed(() =>
{
  if (newBranchMode.value === NEW_BRANCH_CREATE)
  {
    return customName.value.trim();
  }
  else
  {
    return trackingName.value;
  }
}
);

const steps = computed(() =>
{
  if (selectedRef.value)
  {
    let effectiveNewBranchMode: NewBranchMode;
    if (isRemote.value)
    {
      effectiveNewBranchMode = newBranchMode.value;
    }
    else
    {
      effectiveNewBranchMode = NEW_BRANCH_NONE;
    }
    return buildCheckoutSteps({
      ref: selectedRef.value,
      remote: isRemote.value,
      localChanges: flagLocalChanges.value,
      newBranchMode: effectiveNewBranchMode,
      newBranchName: newBranchName.value,
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

const canRun = computed(
  () =>
    !busy.value &&
    selectedRef.value.length > 0 &&
    (!namesLocalBranch.value || newBranchName.value.length > 0) &&
    // Every branch strategy creates one, so an empty name is a form still being filled in.
    (!changesBranch.value || changesBranch.value.name.length > 0)
);

/** True when `-B` would move an existing local branch that already tracks a remote one. */
function isResettingExistingTrackingBranch(
  isRemote: boolean,
  newBranchMode: NewBranchMode,
  trackingBranchExists: boolean
): boolean
{
  return isRemote && newBranchMode === NEW_BRANCH_RESET && trackingBranchExists;
}

/**
 * Everything asked before the first command runs, in the order the answers are
 * needed: both questions are about something being *lost*, asked while nothing has happened yet.
 */
async function confirmed(): Promise<boolean>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return false;
  }

  // git's own rules, asked of git: a name it refuses produces an error after the
  // stash has already been taken. Both names the form can carry go through it.
  let createdName: string;
  if (newBranchMode.value === NEW_BRANCH_CREATE)
  {
    createdName = newBranchName.value;
  }
  else
  {
    createdName = '';
  }
  for (const name of [createdName, changesBranch.value?.name ?? ''])
  {
    if (!name)
    {
      continue;
    }
    if (!(await api['repo:validBranchName'](path, name)))
    {
      error.value = `'${name}' is not a valid branch name.`;
      return false;
    }
  }

  if (isResettingExistingTrackingBranch(isRemote.value, newBranchMode.value, trackingBranchExists.value))
  {
    // `-B` moves the branch wherever it is told. If it is not already an ancestor of the
    // remote branch, it is carrying commits that nothing else will reach afterwards.
    const fastForward = await api['repo:isAncestor'](
      path,
      trackingName.value,
      selectedRef.value
    );
    if (!fastForward)
    {
      const ok = await ui.confirm({
        title: 'Reset a branch that has moved on?',
        message: `\`${trackingName.value}\` has commits that \`${selectedRef.value}\` does not. Resetting it to \`${selectedRef.value}\` leaves them reachable from nothing.`,
        confirmLabel: 'Reset the branch',
        danger: true
      });
      if (!ok)
      {
        return false;
      }
    }
  }

  return true;
}

async function checkout(): Promise<void>
{
  if (!canRun.value)
  {
    return;
  }
  error.value = '';
  if (!(await confirmed()))
  {
    return;
  }

  const stashed = willStash.value;
  // Held open: a stashed checkout still has a question to ask, and a window that closed
  // on success would ask it from nowhere.
  const ok = await runSteps(steps.value, checkoutInvalidates.value, { close: !stashed });
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
  <DialogFrame title="Checkout Branch" @close="emit('close')">
    <div class="form">
      <!-- Hidden when the dialog was opened about a ref: the question "which list?" has
           already been answered by whatever was clicked. -->
      <FormRadioGroup
        v-if="!props.gitRef"
        v-model="source"
        inline
        :options="[
          { value: SOURCE_LOCAL, label: 'Local branch' },
          { value: SOURCE_REMOTE, label: 'Remote branch' }
        ]"
      />

      <FormText
        v-if="props.gitRef"
        v-model="selectedRef"
        label="Branch"
        readonly
        :hint="distance || undefined"
      />
      <RefPicker
        v-else
        v-model="selectedRef"
        label="Branch"
        :kinds="source === SOURCE_LOCAL ? [REF_KIND_BRANCH] : [REF_KIND_REMOTE]"
        :placeholder="source === SOURCE_LOCAL ? 'Pick a branch…' : 'Pick a remote branch…'"
        :hint="distance || undefined"
      />

      <FormGroup v-if="isRemote" label="This is a remote branch">
        <FormRadioGroup v-model="newBranchMode" :options="remoteModeOptions" />
        <FormText
          v-if="newBranchMode === NEW_BRANCH_CREATE"
          v-model="customName"
          label="Name"
          placeholder="feature-x"
        />
      </FormGroup>

      <LocalChangesChoice
        v-model="localChanges"
        v-model:branch-mode="branchMode"
        v-model:branch-name="wipBranchName"
        :dirty="dirty"
        :target="selectedRef"
      />
      <RememberChoice
        v-if="dirty"
        v-model="rememberLocalChanges"
        what="this choice for local changes"
        :disabled="!canRemember"
      />

      <CommandPreview :steps="steps" placeholder="Pick a branch first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!canRun" @click="checkout">
        {{ busy ? 'Checking out…' : 'Checkout' }}
      </button>
    </template>
  </DialogFrame>
</template>
