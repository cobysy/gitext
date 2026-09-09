<script setup lang="ts">
/**
 * Throw away uncommitted work. Most destructive.
 * Checkbox for untracked files (git clean -df).
 * honest answer:
 *
 * - nothing tracked is changed → forced **on**, disabled: the only changes are new files,
 *   so a reset that skipped them would do nothing at all
 * - nothing untracked exists → forced **off**, disabled: there is nothing to delete
 * - a mix → your choice
 */

import { computed, ref, watch } from 'vue';
import { FILE_STATUS_UNTRACKED } from '@shared/types.js';
import {
  buildDiscardSteps,
  DISCARD_SCOPES,
  type DiscardScope
} from '@renderer/model/args/reset.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const props = withDefaults(
  defineProps<{
    /** Everything, or only what is not staged. The surface that opened this decides. */
    scope?: DiscardScope;
  }>(),
  { scope: 'all' }
);

const emit = defineEmits<{ close: [] }>();


const repo = useRepoStore();
const { busy, error, runSteps } = useDialog();

const entry = computed(
  () => DISCARD_SCOPES.find((info) => info.scope === props.scope) ?? DISCARD_SCOPES[0]!
);

const files = computed(() => repo.status?.files ?? []);
const untracked = computed(() =>
  files.value.filter((file) => file.worktree === FILE_STATUS_UNTRACKED || file.index === FILE_STATUS_UNTRACKED)
);
const tracked = computed(() =>
  files.value.filter((file) => file.worktree !== FILE_STATUS_UNTRACKED && file.index !== FILE_STATUS_UNTRACKED)
);

const hasUntracked = computed(() => untracked.value.length > 0);
const hasTracked = computed(() => tracked.value.length > 0);

/** Forced at both ends: the checkbox is only a question when both kinds are present. */
const forced = computed(() => !hasUntracked.value || !hasTracked.value);

const deleteUntracked = ref(false);
const includeIgnored = ref(false);

watch(
  [hasTracked, hasUntracked],
  () =>
  {
    if (!hasUntracked.value)
    {
      deleteUntracked.value = false;
    }
    else if (!hasTracked.value)
    {
      deleteUntracked.value = true;
    }
  },
  { immediate: true }
);

watch(deleteUntracked, (value) =>
{
  if (!value)
  {
    includeIgnored.value = false;
  }
});

const steps = computed(() =>
  buildDiscardSteps({
    scope: props.scope,
    deleteUntracked: deleteUntracked.value,
    includeIgnored: includeIgnored.value
  })
);

/** Nothing to throw away: the button would run two commands over a clean tree. */
const nothingToDo = computed(() => files.value.length === 0);
</script>

<template>
  <DialogFrame :title="entry.title" @close="emit('close')">
    <div class="form">
      <DangerNote>
        {{ entry.detail }} This cannot be undone: uncommitted work is in no commit and no
        reflog.
      </DangerNote>

      <p v-if="nothingToDo" class="placeholder">
        There are no uncommitted changes. Nothing would be discarded.
      </p>
      <p v-else class="hint">
        {{ tracked.length }} changed
        {{ tracked.length === 1 ? 'file' : 'files' }}<template v-if="hasUntracked">
          and {{ untracked.length }} new
          {{ untracked.length === 1 ? 'file' : 'files' }}</template
        >.
      </p>

      <FormCheck
        v-model="deleteUntracked"
        label="Also delete new files and directories"
        :disabled="forced"
        :hint="
          !hasUntracked
            ? 'There are no new files to delete.'
            : !hasTracked
              ? 'Every change here is a new file.'
              : '`clean -d -f`, a reset does not touch new files.'
        "
      />
      <FormCheck
        v-model="includeIgnored"
        label="Delete ignored files too"
        :disabled="!deleteUntracked"
        hint="`clean -x`: build output and anything else `.gitignore` covers."
      />

      <CommandPreview :steps="steps" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button
        class="danger"
        :disabled="busy || nothingToDo"
        @click="runSteps(steps, ['worktree', 'index'])"
      >
        {{ busy ? 'Discarding…' : 'Discard Changes' }}
      </button>
    </template>
  </DialogFrame>
</template>
