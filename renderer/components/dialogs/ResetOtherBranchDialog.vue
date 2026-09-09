<script setup lang="ts">
/**
 * Move a branch you're not standing on. Uses `update-ref` not `reset` (doesn't touch worktree).
 * Safety check: moving a branch can strand commits.
 * no fast-forward check at all. So the button stays disabled until `merge-base
 * --is-ancestor` says this is a fast-forward, or until you tick the box that says you know.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { buildUpdateRefArgs } from '@renderer/model/args/branch.js';
import { buildCheckoutArgs } from '@renderer/model/args/checkout.js';
import type { ArgvStep } from '@renderer/model/args/checkout.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormSelect, { type SelectOption } from '@renderer/components/ui/FormSelect.vue';
import CommitSummary from '@renderer/components/dialogs/parts/CommitSummary.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';
import { REF_KIND_BRANCH } from '@shared/types.js';

const props = defineProps<{
  /** Where the chosen branch is being moved to. */
  commit: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const settings = useSettingsStore();
const { busy, error, runSteps } = useDialog();

const branch = ref('');
const force = ref(false);
const checkoutAfter = ref(settings.settings.checkoutAfterResetOtherBranch);

/**
 * Every local branch except two kinds.
 *
 * The checked-out one, because moving it is `reset` and has its own dialog with five modes
 * this one cannot offer. And any branch already at this commit, because moving it there
 * would be a no-op the dialog would happily let you confirm.
 */
const candidates = computed(() =>
  objects.refs.filter(
    (ref) =>
      ref.kind === REF_KIND_BRANCH &&
      !ref.isCurrent &&
      ref.sha !== repo.repo?.head &&
      !props.commit.startsWith(ref.sha) &&
      !ref.sha.startsWith(props.commit)
  )
);

const options = computed<SelectOption[]>(() =>
  candidates.value.map((ref) => ({ value: ref.name, label: ref.name }))
);

const chosen = computed(() => candidates.value.find((ref) => ref.name === branch.value));

// ── Would this strand anything? ──────────────────────────────────────────────

/** `null` while git is being asked, so the button is not enabled on a stale answer. */
const fastForward = ref<boolean | null>(null);

watch(
  [branch, () => props.commit],
  async () =>
  {
    fastForward.value = null;
    const path = repo.repo?.path;
    const name = chosen.value?.name;
    if (!path || !name)
    {
      return;
    }
    // A fast-forward is exactly "the branch's tip is already an ancestor of the target",
    // which is one `merge-base --is-ancestor`.
    const answer = await api['repo:isAncestor'](path, name, props.commit);
    if (chosen.value?.name !== name)
    {
      return;
    }
    fastForward.value = answer;
  },
  { immediate: true }
);

const wouldStrandCommits = computed(() => fastForward.value === false);

const steps = computed<ArgvStep[]>(() =>
{
  const ref = chosen.value;
  if (!ref)
  {
    return [];
  }
  const steps = [{ label: 'Moving the branch', argv: buildUpdateRefArgs(ref.fullName, props.commit) }];
  if (checkoutAfter.value)
  {
    steps.push({ label: 'Checking the branch out', argv: buildCheckoutArgs({ ref: ref.name }) });
  }
  return steps;
});

const canRun = computed(
  () => !busy.value && !!chosen.value && (fastForward.value === true || force.value)
);

async function reset(): Promise<void>
{
  if (!canRun.value)
  {
    return;
  }
  if (checkoutAfter.value !== settings.settings.checkoutAfterResetOtherBranch)
  {
    await settings.patch({ checkoutAfterResetOtherBranch: checkoutAfter.value });
  }
  // Moving another branch's ref, optionally checking it out afterwards.
  await runSteps(steps.value, [...HISTORY_MOVE]);
}
</script>

<template>
  <DialogFrame title="Reset Another Branch" @close="emit('close')">
    <div class="form">
      <CommitSummary :rev="props.commit" label="Move it to" />

      <FormSelect
        v-model="branch"
        label="Branch"
        :options="options"
        placeholder="Pick a branch…"
        hint="Local branches, never the checked-out one."
      />
      <p v-if="options.length === 0" class="placeholder">
        Every other local branch is checked out or already here.
      </p>

      <DangerNote v-if="wouldStrandCommits">
        <code>{{ branch }}</code> has commits this one does not. Moving it leaves them in the reflog alone.
      </DangerNote>
      <p v-else-if="fastForward === true" class="success">
        This is a fast-forward: nothing on <code>{{ branch }}</code> would stop being reachable.
      </p>
      <p v-else-if="chosen" class="hint">Checking whether anything would be stranded…</p>

      <FormCheck
        v-model="force"
        label="Move it anyway"
        :disabled="!wouldStrandCommits"
        hint="`update-ref` does this without asking."
      />
      <FormCheck
        v-model="checkoutAfter"
        label="Check the branch out afterwards"
        hint="Remembered for next time."
      />

      <CommandPreview :steps="steps" placeholder="Pick a branch first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button
        :class="wouldStrandCommits ? 'danger' : 'primary'"
        :disabled="!canRun"
        @click="reset"
      >
        {{ busy ? 'Moving…' : 'Move Branch' }}
      </button>
    </template>
  </DialogFrame>
</template>
