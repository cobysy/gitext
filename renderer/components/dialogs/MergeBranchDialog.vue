<script setup lang="ts">
/**
 * Merging a branch into the one you are on. **Fast-forward is a radio, not a
 * checkbox**: "keep a single line where possible" and "always record a merge" are two
 * intentions, neither the absence of the other. **The message goes to `.git/MERGE_MSG`
 * via `-F`, never `-m`**: `-m` leaves `MERGE_MSG` holding git's generated text, so a
 * merge that stops on a conflict would offer the wrong text when resumed.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { buildMergeArgs, MERGE_STRATEGIES, type MergeStrategy } from '@renderer/model/args/merge.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { flagsIn } from '@renderer/model/args/summary.js';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormNumber from '@renderer/components/ui/FormNumber.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';
import RefPicker from '@renderer/components/dialogs/parts/RefPicker.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';
import { MERGE_MSG_FILE } from '@shared/types.js';


// Fast-forward radio choices
const FF_CHOICE_FF = 'ff';
const FF_CHOICE_NO_FF = 'no-ff';

// Git flags shown in the folded-panel summary
const FLAG_NO_FF = '--no-ff';
const FLAG_NO_COMMIT = '--no-commit';
const FLAG_NO_EDIT = '--no-edit';

// Default merge strategy
const STRATEGY_ORT = 'ort';

const props = defineProps<{
  /** The ref to merge in, when a surface named one. */
  gitRef?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const settings = useSettingsStore();
const { busy, error, perform } = useDialog();

const source = ref(props.gitRef ?? '');

// Both persist, as `NoFastForwardMerge` and `DontCommitMerge` do.
const fastForward = ref(!settings.settings.mergeNoFastForward);
const noCommit = ref(settings.settings.mergeNoCommit);

const showAdvanced = ref(false);
const squash = ref(false);
const useStrategy = ref(false);
const strategy = ref<MergeStrategy>(STRATEGY_ORT);
const allowUnrelated = ref(false);
const addLog = ref(settings.settings.mergeAddLogMessages);
const logCount = ref<number | null>(settings.settings.mergeLogMessageCount);
const addMessage = ref(false);
const message = ref('');

const currentBranch = computed(() => repo.repo?.branch ?? null);

/** `--squash` and `--no-ff` are contradictory: one makes no commit, the other insists. */
watch(fastForward, (value) =>
{
  if (!value)
  {
    squash.value = false;
  }
});

/**
 * What the folded panel is carrying, read out of the argv about to run, so a
 * ticked-and-hidden box's flag is always visible rather than silently discarded when
 * folded. `--no-ff`/`--no-commit` are excluded since their controls are above the fold; `--no-edit` is on every merge this dialog runs.
 */
const advancedSummary = computed(() =>
  flagsIn(argv.value, [FLAG_NO_FF, FLAG_NO_COMMIT, FLAG_NO_EDIT])
);

const fastForwardOptions: readonly RadioOption[] = [
  {
    value: FF_CHOICE_FF,
    label: 'Keep a single line of history where possible',
    hint: "git's default, no merge commit when it can avoid one."
  },
  {
    value: FF_CHOICE_NO_FF,
    label: 'Always create a merge commit',
    hint: '`--no-ff`, always records the merge.'
  }
];

const fastForwardChoice = computed({
  get: () =>
  {
    if (fastForward.value)
    {
      return FF_CHOICE_FF;
    }
    else
    {
      return FF_CHOICE_NO_FF;
    }
  },
  set: (value: string) =>
  {
    fastForward.value = value === FF_CHOICE_FF;
  }
});

const strategyOptions = MERGE_STRATEGIES.map((entry) => ({
  value: entry.strategy,
  label: `${entry.label}, ${entry.detail}`
}));

/**
 * The argv, with the message file's path as it *will* be. The file isn't written when
 * the preview is drawn, and can't be: writing it on every keystroke would leave a
 * `MERGE_MSG` behind for a cancelled dialog. `merge()` writes it immediately before running with the same path.
 */
const messagePath = computed(() =>
{
  if (addMessage.value && message.value.trim())
  {
    return `${repo.repo?.gitDir ?? '.git'}/MERGE_MSG`;
  }
  else
  {
    return null;
  }
}
);

const argv = computed(() =>
{
  let strategyArg: MergeStrategy | null;
  if (useStrategy.value)
  {
    strategyArg = strategy.value;
  }
  else
  {
    strategyArg = null;
  }
  let logCountArg: number | null;
  if (addLog.value)
  {
    logCountArg = logCount.value;
  }
  else
  {
    logCountArg = null;
  }
  return buildMergeArgs({
    ref: source.value,
    fastForward: fastForward.value,
    squash: squash.value,
    noCommit: noCommit.value,
    strategy: strategyArg,
    allowUnrelatedHistories: allowUnrelated.value,
    messageFile: messagePath.value,
    logCount: logCountArg
  });
});

async function merge(): Promise<void>
{
  if (!source.value || busy.value)
  {
    return;
  }

  const patch: Parameters<typeof settings.patch>[0] = {
    mergeNoFastForward: !fastForward.value,
    mergeNoCommit: noCommit.value,
    mergeAddLogMessages: addLog.value
  };
  if (logCount.value !== null)
  {
    patch.mergeLogMessageCount = logCount.value;
  }
  await settings.patch(patch);

  await perform(
    'Merging',
    async (repoPath) =>
    {
      // Written here, not reactively: a `MERGE_MSG` left behind by a cancelled dialog would be picked up by the *next* merge, a message appearing from nowhere.
      if (messagePath.value)
      {
        await api['git:writeMessageFile'](repoPath, MERGE_MSG_FILE, message.value);
      }
      await runConsoleSteps(repoPath, [{ label: 'Merging', argv: argv.value }], HISTORY_MOVE);
    },
    // A merge that conflicts exits non-zero, and that's the merge *working*: git has
    // written both sides into the working tree, waiting to be told which to keep. See `useDialog`.
    { allowConflicts: true }
  );
}
</script>

<template>
  <DialogFrame title="Merge Branch" @close="emit('close')">
    <div class="form">
      <RefPicker
        v-model="source"
        label="Merge in"
        :kinds="['branch', 'remote', 'tag']"
        :extra="props.gitRef"
        exclude-current
        :hint="
          currentBranch
            ? `Its commits are brought into \`${currentBranch}\`, which is the branch that moves.`
            : '`HEAD` is detached, the merge lands on no branch at all.'
        "
      />

      <FormGroup label="History">
        <FormRadioGroup v-model="fastForwardChoice" :options="fastForwardOptions" />
      </FormGroup>

      <FormCheck
        v-model="noCommit"
        label="Do not commit the merge"
        hint="`--no-commit`: stops with the merge staged."
      />

      <FormDisclosure v-model="showAdvanced" :summary="advancedSummary">
        <FormCheck
          v-model="squash"
          label="Squash the commits into one set of changes"
          :disabled="!fastForward"
          :hint="
            fastForward
              ? '`--squash`: no merge commit; the source is not recorded.'
              : 'Not available with “always create a merge commit”.'
          "
        />
        <FormCheck
          v-model="allowUnrelated"
          label="Allow unrelated histories"
          hint="`--allow-unrelated-histories`: for two separate repositories."
        />

        <FormCheck v-model="useStrategy" label="Use a non-default merge strategy" />
        <FormSelect
          v-if="useStrategy"
          v-model="strategy"
          label="Strategy"
          :options="strategyOptions"
        />

        <FormCheck
          v-model="addLog"
          label="Summarize merged commits"
          hint="`--log`: lists the one-line subjects of what came in."
        />
        <FormNumber
          v-if="addLog"
          v-model="logCount"
          label="How many"
          :min="1"
          :max="100"
        />

        <FormCheck v-model="addMessage" label="Write the merge message myself" />
        <FormTextArea
          v-if="addMessage"
          v-model="message"
          label="Message"
          :rows="4"
          hint="`-F .git/MERGE_MSG`: survives a conflict."
        />
      </FormDisclosure>

      <CommandPreview :argv="argv" placeholder="Pick a branch first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!source || busy" @click="merge">
        {{ busy ? 'Merging…' : 'Merge' }}
      </button>
    </template>
  </DialogFrame>
</template>
