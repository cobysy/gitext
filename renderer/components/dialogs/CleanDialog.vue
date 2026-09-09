<script setup lang="ts">
/**
 * Delete untracked files. Preview button is why dialog exists:
 * safe --dry-run before delete.
 */

import { computed, ref } from 'vue';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import {
  buildCleanArgs,
  buildCleanSubmodulesArgs,
  CLEAN_MODES,
  type CleanMode,
  type CleanOptions
} from '@renderer/model/args/clean.js';
import type { ArgvStep } from '@renderer/model/args/checkout.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useUiStore } from '@renderer/stores/ui.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { READS, WORKING_TREE } from '@shared/invalidation.js';

const emit = defineEmits<{ close: [] }>();

const objects = useRepoObjectsStore();
const ui = useUiStore();
const { busy, error, runSteps, perform } = useDialog();

const mode = ref<CleanMode>('untracked');
const directories = ref(true);
const submodules = ref(false);
const includePaths = ref('');
const excludePaths = ref('');

const modeOptions: readonly RadioOption[] = CLEAN_MODES.map((entry) => ({
  value: entry.mode,
  label: entry.label,
  hint: entry.detail
}));

/** One path per line. */
function lines(text: string): string[]
{
  return text.split('\n');
}

const hasSubmodules = computed(() => objects.submodules.length > 0);

const options = computed<CleanOptions>(() => ({
  mode: mode.value,
  directories: directories.value,
  paths: lines(includePaths.value),
  excludes: lines(excludePaths.value)
}));

/** The plan, for whichever of the two buttons is being described. */
function plan(dryRun: boolean): ArgvStep[]
{
  const settings = { ...options.value, dryRun };
  let mainLabel: string;
  if (dryRun)
  {
    mainLabel = 'Listing what would go';
  }
  else
  {
    mainLabel = 'Cleaning';
  }
  const steps: ArgvStep[] = [{ label: mainLabel, argv: buildCleanArgs(settings) }];
  if (submodules.value && hasSubmodules.value)
  {
    let submoduleLabel: string;
    if (dryRun)
    {
      submoduleLabel = 'Listing the submodules';
    }
    else
    {
      submoduleLabel = 'Cleaning the submodules';
    }
    steps.push({ label: submoduleLabel, argv: buildCleanSubmodulesArgs(settings) });
  }
  return steps;
}

const steps = computed(() => plan(false));

/**
 * Stays open, and does not refresh: a dry run changes nothing, and this window is where
 * the choices that produced the list are. The list itself goes to the console, like the
 * output of every other command: `--dry-run` prints what would go, and printed output
 * is what that window is for. A run that lists nothing shows the console's own "git
 * printed nothing", which is the same answer.
 */
async function runPreview(): Promise<void>
{
  await perform(
    'Previewing the cleanup',
    async (repoPath) =>
    {
      // `console: true`: the whole point of the button is reading what it printed.
      // `keepOpen`: the list of what would go is the whole point of the button, so
      // the window holding it does not close itself a few seconds later.
      await runConsoleSteps(repoPath, plan(true), READS, { console: true, keepOpen: true });
    },
    { close: false, refresh: false }
  );
}

async function clean(): Promise<void>
{
  const ok = await ui.confirm({
    title: 'Clean the working directory?',
    message:
      'Deleted from disk. They are in no commit and no stash.',
    confirmLabel: 'Delete them',
    danger: true
  });
  if (!ok)
  {
    return;
  }
  // `console`/`consoleKeepOpen`: `git clean` names every file it removed, and that list
  // is the only record of it. Nothing else in the app can show you what was deleted.
  await runSteps(steps.value, WORKING_TREE, { console: true, consoleKeepOpen: true });
}
</script>

<template>
  <DialogFrame title="Clean Working Directory" @close="emit('close')">
    <div class="form">
      <DangerNote>
        Untracked: git holds no copy. Preview runs it with <code>--dry-run</code>.
      </DangerNote>

      <FormGroup label="What to delete">
        <FormRadioGroup v-model="mode" :options="modeOptions" />
      </FormGroup>

      <FormCheck
        v-model="directories"
        label="Remove untracked directories"
        hint="`-d`: otherwise empty folders are left behind."
      />
      <FormCheck
        v-if="hasSubmodules"
        v-model="submodules"
        label="Clean submodules too"
        hint="`submodule foreach`: `git clean` stops at this repository."
      />

      <FormTextArea
        v-model="includePaths"
        label="Only these paths"
        :rows="3"
        monospace
        placeholder="One path per line. Empty means the whole working directory."
      />
      <FormTextArea
        v-model="excludePaths"
        label="Spare these"
        :rows="3"
        monospace
        placeholder="One pattern per line: becomes --exclude=…"
      />

      <CommandPreview :steps="steps" />

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button :disabled="busy" @click="runPreview">
        {{ busy ? 'Working…' : 'Preview' }}
      </button>
      <button class="danger" :disabled="busy" @click="clean">
        {{ busy ? 'Cleaning…' : 'Clean' }}
      </button>
    </template>
  </DialogFrame>
</template>
