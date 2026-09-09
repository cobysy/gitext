<script setup lang="ts">
/**
 * Apply patch: dialog asks which command (apply drops authorship, am makes commits).
 * Doubles as exit from stopped sequencer (like rebase dialog).
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import {
  APPLY_MODES,
  buildApplyPatchArgs,
  buildApplyStepArgs,
  type ApplyMode,
  type ApplyStep
} from '@renderer/model/args/patch.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormPathText from '@renderer/components/ui/FormPathText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';

// Apply modes
const APPLY_MODE_AM = 'am';
const APPLY_MODE_APPLY = 'apply';

// Apply steps
const STEP_CONTINUE = 'continue';
const STEP_SKIP = 'skip';
const STEP_ABORT = 'abort';

// Repo facets for a bare `git apply`
const APPLY_FACETS = ['worktree', 'index'] as const;

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const { busy, error, run, perform, close } = useDialog();

const mode = ref<ApplyMode>(APPLY_MODE_AM);
const file = ref('');
const ignoreWhitespace = ref(false);
const index = ref(false);

const modeOptions: readonly RadioOption[] = APPLY_MODES.map((entry) => ({
  value: entry.mode,
  label: entry.label,
  hint: entry.detail
}));

/**
 * Mid-`am` is the other face of this window.
 *
 * `getRepoState` reports it as `'am'`; while it is running the form that starts one is
 * beside the point and the three ways out are the whole of what is wanted.
 */
const midApply = computed(() => repo.state.operation === APPLY_MODE_AM);

const argv = computed(() =>
  buildApplyPatchArgs({
    mode: mode.value,
    file: file.value,
    ignoreWhitespace: ignoreWhitespace.value,
    index: index.value
  })
);

async function chooseFile(): Promise<void>
{
  await perform(
    'Choosing a patch',
    async () =>
    {
      // `am` takes a directory of them as happily as one file, which is what a
      // `format-patch` of six commits produces: so the picker offers both.
      const chosen = await api['file:choosePatch'](repo.repo?.path ?? '');
      if (chosen)
      {
        file.value = chosen;
      }
    },
    { close: false, refresh: false }
  );
}

async function apply(): Promise<void>
{
  // A patch that does not apply cleanly leaves `am`'s sequencer running with conflicts in
  // the working tree, which is the operation having happened rather than a refusal.
  // `am` replays commits onto the branch; a bare `apply` only rewrites files.
  let invalidates;
  if (mode.value === APPLY_MODE_AM)
  {
    invalidates = HISTORY_MOVE;
  }
  else
  {
    invalidates = APPLY_FACETS;
  }
  await run(argv.value, invalidates, { allowConflicts: mode.value === APPLY_MODE_AM, close: false });
  if (!error.value && !midApply.value)
  {
    close();
  }
}

async function step(which: ApplyStep): Promise<void>
{
  await run(buildApplyStepArgs(which), HISTORY_MOVE, { close: false });
}
</script>

<template>
  <DialogFrame title="Apply Patch" @close="emit('close')">
    <!-- Mid-apply: the control panel, not the form. Same shape as the rebase dialog. -->
    <div v-if="midApply" class="form">
      <DangerNote>
        Part-way through. Resolve and continue, skip, or abort.
      </DangerNote>
      <CommandPreview :argv="buildApplyStepArgs(STEP_CONTINUE)" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-else class="form">
      <FormPathText
        v-model="file"
        label="Patch"
        placeholder="A .patch file, or a folder of them"
        browse-label="Choose a file or folder…"
        :disabled="busy"
        @browse="chooseFile"
      />

      <FormGroup label="How to apply it">
        <FormRadioGroup v-model="mode" :options="modeOptions" />
      </FormGroup>

      <FormCheck
        v-model="ignoreWhitespace"
        label="Ignore whitespace differences"
        hint="`--ignore-whitespace`"
      />
      <FormCheck
        v-if="mode === APPLY_MODE_APPLY"
        v-model="index"
        label="Stage the changes as well"
        hint="`--index`: otherwise they land unstaged."
      />

      <CommandPreview :argv="argv" placeholder="Choose a patch file" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">{{ midApply ? 'Close' : 'Cancel' }}</button>
      <template v-if="midApply">
        <button class="danger" :disabled="busy" @click="step(STEP_ABORT)">Abort</button>
        <button :disabled="busy" @click="step(STEP_SKIP)">Skip This Patch</button>
        <button class="primary" :disabled="busy" @click="step(STEP_CONTINUE)">Continue</button>
      </template>
      <button v-else class="primary" :disabled="!argv.length || busy" @click="apply">
        {{ busy ? 'Applying…' : 'Apply' }}
      </button>
    </template>
  </DialogFrame>
</template>
