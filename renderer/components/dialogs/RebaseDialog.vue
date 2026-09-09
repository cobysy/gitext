<script setup lang="ts">
/**
 * Two modes: starting a rebase, or managing one already in progress.
 * When in progress, this is where you resolve conflicts and step through.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import {
  buildRebaseArgs,
  buildRebaseStepArgs,
  REBASE_DATES,
  REBASE_STEPS,
  type RebaseDates,
  type RebaseStep
} from '@renderer/model/args/rebase.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { OPERATION_REBASE } from '@shared/types.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { flagsIn } from '@renderer/model/args/summary.js';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import RefPicker from '@renderer/components/dialogs/parts/RefPicker.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';

const props = defineProps<{
  /** The ref to rebase onto, when a surface named one. */
  onto?: string;
  /** Open with `-i` already ticked. */
  interactive?: boolean;
  /** Open with the options panel expanded, without deciding anything inside it. */
  advanced?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

// Operations and dates
const DATES_DEFAULT = 'default';
const STEP_ABORT = 'abort';

// Config keys read at mount
const CONFIG_KEY_UPDATE_REFS = 'rebase.updaterefs';
const CONFIG_KEY_AUTOSQUASH = 'rebase.autosquash';
const CONFIG_VALUE_TRUE = 'true';

const repo = useRepoStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { busy, error, run, perform, close } = useDialog();

/** Which face the window is showing. Not a mode the user picks: a fact about `.git`. */
const midRebase = computed(() => repo.state.operation === OPERATION_REBASE);

// ── Starting one ─────────────────────────────────────────────────────────────

const upstream = ref(props.onto ?? '');
const showOptions = ref((props.interactive ?? false) || (props.advanced ?? false));
const interactive = ref(props.interactive ?? false);
const autosquash = ref(false);
const rebaseMerges = ref(false);
const dates = ref<RebaseDates>(DATES_DEFAULT);
const autostash = ref(settings.settings.rebaseAutostash);
const useRange = ref(false);
const rangeFrom = ref('');
const rangeOnto = ref('');

/**
 * What `rebase.updaterefs` resolves to, so the flag can be omitted when the box agrees
 * with it. Null until git has answered.
 */
const configuredUpdateRefs = ref<boolean | null>(null);
const updateRefs = ref(false);

const dirty = computed(() => (repo.status?.files.length ?? 0) > 0);
const currentBranch = computed(() => repo.repo?.branch ?? null);

watch(
  () => repo.repo?.path,
  async (path) =>
  {
    if (!path)
    {
      return;
    }
    const config = await api['repo:config'](path, [CONFIG_KEY_UPDATE_REFS, CONFIG_KEY_AUTOSQUASH]);
    configuredUpdateRefs.value = config[CONFIG_KEY_UPDATE_REFS] === CONFIG_VALUE_TRUE;
    updateRefs.value = configuredUpdateRefs.value;
    if (config[CONFIG_KEY_AUTOSQUASH] === CONFIG_VALUE_TRUE)
    {
      autosquash.value = true;
    }
  },
  { immediate: true }
);

// The date options replace interactive rather than sitting beside it: `-i` is never added
// when either is set, so a ticked box that produced no flag would be a lie.
watch(dates, (value) =>
{
  if (value !== DATES_DEFAULT)
  {
    interactive.value = false;
  }
});
watch(interactive, (value) =>
{
  if (value)
  {
    dates.value = DATES_DEFAULT;
  }
});

const dateOptions = computed<readonly RadioOption[]>(() =>
  REBASE_DATES.map((entry) => ({
    value: entry.value,
    label: entry.label,
    hint: entry.detail
  }))
);

/**
 * Omit when it matches the config default. A flag that matches what's already configured reads like a pointless choice.
 */
const updateRefsArg = computed(() =>
{
  if (configuredUpdateRefs.value === null || updateRefs.value === configuredUpdateRefs.value)
  {
    return null;
  }
  else
  {
    return updateRefs.value;
  }
}
);

const argv = computed(() =>
{
  if (upstream.value)
  {
    let from: string | null;
    if (useRange.value)
    {
      from = rangeFrom.value || null;
    }
    else
    {
      from = null;
    }
    let onto: string | null;
    if (useRange.value)
    {
      onto = rangeOnto.value || null;
    }
    else
    {
      onto = null;
    }
    return buildRebaseArgs({
      upstream: upstream.value,
      from,
      onto,
      interactive: interactive.value,
      autosquash: autosquash.value,
      rebaseMerges: rebaseMerges.value,
      dates: dates.value,
      updateRefs: updateRefsArg.value,
      autostash: autostash.value
    });
  }
  else
  {
    return [];
  }
}
);

/**
 * What the folded options panel is carrying, read out of the argv itself.
 *
 * Every flag `rebase` takes here comes from a control inside the fold: the only thing
 * above it is which ref to rebase onto: so nothing is excluded.
 */
const optionsSummary = computed(() => flagsIn(argv.value));

/** A range needs both ends: `--onto` without one replays the wrong commits, silently. */
const rangeIncomplete = computed(
  () => useRange.value && (!rangeFrom.value.trim() || !rangeOnto.value.trim())
);

/** True once there is an upstream, a complete range if one is in play, and nothing else running. */
function canStartRebase(upstream: string, rangeIncomplete: boolean, busy: boolean): boolean
{
  return !!upstream && !rangeIncomplete && !busy;
}

async function startRebase(): Promise<void>
{
  if (!canStartRebase(upstream.value, rangeIncomplete.value, busy.value))
  {
    return;
  }
  await settings.patch({ rebaseAutostash: autostash.value });

  await perform('Rebasing', async (repoPath) =>
  {
    const output = await runConsoleSteps(
      repoPath,
      [{ label: 'Rebasing', argv: argv.value }],
      HISTORY_MOVE
    );
    // git says this on stdout and exits 0. It is not an error, but a dialog that closes
    // silently on it leaves you wondering whether anything happened.
    if (/is up to date\.?$/m.test(output.trim()))
    {
      ui.toast('Nothing to rebase: the branch is already up to date.', 'info');
    }
  });
}

// ── Finishing one ────────────────────────────────────────────────────────────

const conflicts = computed(() => repo.state.conflictCount);

async function step(which: RebaseStep): Promise<void>
{
  if (which === STEP_ABORT)
  {
    const ok = await ui.confirm({
      title: 'Abort the rebase?',
      message:
        'The branch goes back to where it was. Everything replayed so far is discarded.',
      confirmLabel: 'Abort the rebase',
      danger: true
    });
    if (!ok)
    {
      return;
    }
  }
  // Held open: continuing a rebase usually stops again at the next conflict, and a window
  // that closed after each step would have to be reopened for every commit.
  const done = await run(buildRebaseStepArgs(which), HISTORY_MOVE, { close: false });
  // Only when git is actually finished with it.
  if (done && repo.state.operation !== OPERATION_REBASE)
  {
    close();
  }
}
</script>

<template>
  <DialogFrame :title="midRebase ? 'Rebase in Progress' : 'Rebase'" @close="emit('close')">
    <!-- ── A rebase git has already stopped in the middle of ── -->
    <div v-if="midRebase" class="form">
      <DangerNote v-if="conflicts > 0">
        {{ conflicts }} {{ conflicts === 1 ? 'file has' : 'files have' }} conflicts. Resolve
        them and stage the result before continuing.
      </DangerNote>
      <p v-else class="hint">
        Part-way through, nothing conflicted. It stopped to let you edit.
      </p>

      <button
        v-if="conflicts > 0"
        class="primary"
        @click="ui.openDialog('conflicts.resolve')"
      >
        Solve the conflicts…
      </button>

      <!-- Each step with its hint beside it; a separate legend would be ignored. -->
      <div class="steps">
        <div v-for="entry in REBASE_STEPS" :key="entry.step" class="step">
          <button
            :class="entry.danger ? 'danger' : undefined"
            :disabled="busy"
            @click="step(entry.step)"
          >
            {{ entry.label }}
          </button>
          <span class="hint">{{ entry.detail }}</span>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <!-- ── Starting one ── -->
    <div v-else class="form">
      <RefPicker
        v-model="upstream"
        label="Rebase onto"
        :kinds="['branch', 'remote', 'tag']"
        :extra="props.onto"
        exclude-current
        :hint="
          currentBranch
            ? `\`${currentBranch}\` is replayed on top of it, one commit at a time.`
            : '`HEAD` is detached, there is no branch to move.'
        "
      />

      <FormDisclosure v-model="showOptions" :summary="optionsSummary">
        <FormCheck
          v-model="interactive"
          label="Interactive"
          hint="`-i`: needed for autosquash. The todo list is not editable here."
        />
        <FormCheck
          v-model="autosquash"
          label="Autosquash fixup! and squash! commits"
          :disabled="!interactive"
          hint="`--autosquash`: interactive rebases only."
        />
        <FormCheck
          v-model="rebaseMerges"
          label="Replay merge commits as merges"
          hint="`--rebase-merges`: otherwise merges are flattened."
        />
        <FormCheck
          v-model="autostash"
          label="Stash uncommitted changes and put them back"
          :disabled="!dirty"
          :hint="
            dirty
              ? '`--autostash`: so a dirty tree does not refuse.'
              : 'Nothing uncommitted to stash.'
          "
        />
        <FormCheck
          v-model="updateRefs"
          label="Move branches in the range"
          :hint="
            updateRefsArg === null
              ? 'Matches your `rebase.updaterefs` setting, so no flag is sent.'
              : `\`--${updateRefs ? '' : 'no-'}update-refs\`, overriding \`rebase.updaterefs\` for this run.`
          "
        />

        <FormGroup label="Dates">
          <FormRadioGroup v-model="dates" :options="dateOptions" />
        </FormGroup>

        <FormCheck
          v-model="useRange"
          label="Rebase a specific range of commits"
          hint="`--onto`: replays only part of the branch."
        />
        <template v-if="useRange">
          <FormText v-model="rangeFrom" label="From (exclusive)" placeholder="HEAD~5" />
          <FormText v-model="rangeOnto" label="Onto" placeholder="main" />
        </template>
      </FormDisclosure>

      <CommandPreview :argv="argv" placeholder="Pick what to rebase onto first" />
      <p v-if="rangeIncomplete" class="warn">
        A range needs both ends.
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">{{ midRebase ? 'Close' : 'Cancel' }}</button>
      <button
        v-if="!midRebase"
        class="primary"
        :disabled="!upstream || rangeIncomplete || busy"
        @click="startRebase"
      >
        {{ busy ? 'Rebasing…' : 'Rebase' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* Steps are equals (no primary), except while conflicts remain: then resolve is the only valid action. */
.steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.step {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.step button {
  flex: none;
  min-width: 140px;
}
</style>
