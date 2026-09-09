<script setup lang="ts">
/**
 * Reset branch to commit. Added --keep and --merge: make reset usable on
 * dirty tree. Modes from table for consistency.
 */

import { computed, ref } from 'vue';
import { buildResetArgs, RESET_MODES, type ResetMode } from '@renderer/model/args/reset.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, {
  type RadioOption
} from '@renderer/components/ui/FormRadioGroup.vue';
import CommitSummary from '@renderer/components/dialogs/parts/CommitSummary.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';

// Reset modes
const RESET_MODE_MIXED = 'mixed';
const RESET_MODE_KEEP = 'keep';
const RESET_MODE_MERGE = 'merge';
const RESET_HARD_MODE = 'hard';

const props = defineProps<{
  /** The commit the branch moves to. */
  commit: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, run } = useDialog();

/**
 * Mixed, as git's own default is.
 *
 * Soft leaves everything between here and there staged, which on a reset of more than one
 * commit is a commit screen full of files nobody asked for. Mixed is what `git reset`
 * alone does, so it is also the one whose behaviour a reader already knows.
 */
const mode = ref<ResetMode>(RESET_MODE_MIXED);

const options = computed<readonly RadioOption[]>(() =>
  RESET_MODES.map((entry) => ({
    value: entry.mode,
    label: `${entry.label} · \`${entry.flag}\``,
    hint: entry.detail,
    tone: entry.tone
  }))
);

const chosen = computed(() => RESET_MODES.find((entry) => entry.mode === mode.value));

const branch = computed(() => repo.repo?.branch ?? null);
const dirty = computed(() => (repo.status?.files.length ?? 0) > 0);

const argv = computed(() => buildResetArgs({ mode: mode.value, commit: props.commit }));

async function reset(): Promise<void>
{
  if (busy.value)
  {
    return;
  }

  // The one mode with nothing behind it: `--hard` discards work git has never seen, so
  // there is no reflog entry and no dangling commit to recover it from.
  if (mode.value === RESET_HARD_MODE)
  {
    let message: string;
    if (dirty.value)
    {
      message =
        'Every uncommitted change goes. Work git has never seen cannot be recovered.';
    }
    else
    {
      message =
        'Moves the branch and the working directory. Commits left behind live only in the reflog.';
    }
    const confirmed = await ui.confirm({
      title: 'Discard all local changes?',
      message,
      confirmLabel: 'Reset and discard changes',
      danger: true
    });
    if (!confirmed)
    {
      return;
    }
  }

  await run(argv.value, HISTORY_MOVE);
}
</script>

<template>
  <DialogFrame title="Reset Current Branch" @close="emit('close')">
    <div class="form">
      <CommitSummary
        :rev="props.commit"
        :label="branch ? `Move \`${branch}\` to` : 'Move `HEAD` to'"
      />

      <FormGroup label="What happens to your files">
        <FormRadioGroup v-model="mode" :options="options" />
      </FormGroup>

      <DangerNote v-if="mode === RESET_HARD_MODE">
        Every uncommitted change is discarded, staged and unstaged.
      </DangerNote>
      <!-- Not a warning: aborting is the safe behaviour, and saying so up front is what
           stops it reading as a failure when it happens. -->
      <p
        v-else-if="dirty && (mode === RESET_MODE_KEEP || mode === RESET_MODE_MERGE)"
        class="hint"
      >
        Uncommitted changes: this mode stops rather than overwrite them.
      </p>

      <p class="hint">
        <a :href="chosen?.help" target="_blank" rel="noreferrer">
          What {{ chosen?.flag }} does, in git's own documentation
        </a>
      </p>

      <CommandPreview :argv="argv" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button :class="mode === RESET_HARD_MODE ? 'danger' : 'primary'" :disabled="busy" @click="reset">
        {{ busy ? 'Resetting…' : 'Reset' }}
      </button>
    </template>
  </DialogFrame>
</template>
