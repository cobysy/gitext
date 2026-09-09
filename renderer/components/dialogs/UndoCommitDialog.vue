<script setup lang="ts">
/**
 * Undo last commit (reset --soft HEAD~1). Dialog names commit:
 * 'undo' does two: removes commit, restages contents.
 * that is about to be gone, and says where the changes end up.
 */

import { computed } from 'vue';
import { buildUndoCommitArgs } from '@renderer/model/args/reset.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import CommitSummary from '@renderer/components/dialogs/parts/CommitSummary.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';
import { HEAD_REF } from '@renderer/model/sha.js';


const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const { busy, error, run } = useDialog();

const argv = computed(() => buildUndoCommitArgs());

const branch = computed(() => repo.repo?.branch ?? null);
/**
 * Nothing committed yet, so nothing to undo.
 *
 * A *root* commit, one that exists but has no parent, is deliberately not detected here:
 * `HEAD~1` simply does not resolve, git says so, and `useDialog` puts that stderr under
 * the form. A second git read to pre-empt a message git already writes clearly would be
 * the dialog guessing at what it can just let happen.
 */
const nothingToUndo = computed(() => repo.repo?.head == null);
</script>

<template>
  <DialogFrame title="Undo Last Commit" @close="emit('close')">
    <div class="form">
      <CommitSummary :rev="HEAD_REF" label="Undoing" />

      <DangerNote tone="warning">
        The commit is removed from
        <code>{{ branch ?? HEAD_REF }}</code> and its message goes with it. Everything it
        changed comes back <strong>staged</strong>, ready to be committed again.
      </DangerNote>

      <p class="hint">
        Nothing is lost, and the commit stays in the reflog: <code>git reset --hard ORIG_HEAD</code> puts it back.
      </p>

      <CommandPreview :argv="argv" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="busy || nothingToUndo" @click="run(argv, HISTORY_MOVE)">
        {{ busy ? 'Undoing…' : 'Undo Commit' }}
      </button>
    </template>
  </DialogFrame>
</template>
