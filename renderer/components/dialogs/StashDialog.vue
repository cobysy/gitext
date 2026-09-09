<script setup lang="ts">
/**
 * Saving a stash: the message, what to sweep in with it, and the working tree it is
 * about, in the panes above the form.
 *
 * Only saving. What you already stashed is `ManageStashesDialog`, a window of its own:
 * one window that switched between the two opened on this form whenever nothing was
 * stashed yet, which is when someone who asked to manage them is most sure the app
 * ignored them.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { buildStashSaveArgs } from '@renderer/model/args/stash.js';
import type { DiffRange } from '@shared/diff.js';
import { registerCommands } from '@renderer/commands/index.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import RepoFilePanes from '@renderer/components/dialogs/parts/RepoFilePanes.vue';

// A dialog window otherwise starts with none of the command registry: `DialogHost`
// never calls `useCommands()`, but the panes below resolve their own
// menus and commands through it regardless of window. Idempotent per window.
registerCommands();

const props = withDefaults(
  defineProps<{
    /** Open with only what is staged selected for stashing. */
    stagedOnly?: boolean;
  }>(),
  { stagedOnly: false }
);

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const settings = useSettingsStore();
const diff = useDiffStore();
// Stays open: stashing is often the first of two things you came to do, so the run passes
// `{ close: false }` and the panes reload to show a clean working tree.
const { busy, error, run, close } = useDialog();

const message = ref('');
const includeUntracked = ref(settings.settings.stashIncludeUntracked);
const keepIndex = ref(settings.settings.stashKeepIndex);
const stagedOnly = ref(props.stagedOnly);

const files = computed(() => repo.status?.files ?? []);

/** What the diff pivot compares the working tree to: everything not yet committed. */
const WORKDIR_RANGE: DiffRange = { from: { kind: 'commit', sha: 'HEAD' }, to: { kind: 'workingTree' } };

// The panes show what would be stashed: everything not yet committed.
diff.setRange(WORKDIR_RANGE);

const dirty = computed(() => files.value.length > 0);

// `--staged` and `-u` contradict each other: an untracked file isn't staged, and git rejects the pair outright.
watch(stagedOnly, (value) =>
{
  if (value)
  {
    includeUntracked.value = false;
    keepIndex.value = false;
  }
});

const saveArgv = computed(() =>
  buildStashSaveArgs({
    message: message.value,
    includeUntracked: includeUntracked.value,
    keepIndex: keepIndex.value,
    stagedOnly: stagedOnly.value
  })
);

async function stash(): Promise<void>
{
  if (!dirty.value)
  {
    return;
  }
  await settings.patch({
    stashIncludeUntracked: includeUntracked.value,
    stashKeepIndex: keepIndex.value
  });
  if (!(await run(saveArgv.value, ['stashes', 'worktree', 'index', 'commits'], { close: false })))
  {
    return;
  }
  message.value = '';
  await repo.refresh();
}

onMounted(async () =>
{
  // This window always shows *changed* files, never "browse the tree at a revision".
  // Direct assignment, not `settings.patch(...)`: that persists and broadcasts to every open window, and opening this dialog must not silently flip the main window's preference.
  settings.settings.filesPaneMode = 'changed';
  await repo.refresh();
});
</script>

<template>
  <DialogFrame title="Stash Changes" fixed-height @close="emit('close')">
    <div class="stash">
      <RepoFilePanes class="split" />

      <div class="form">
        <FormText
          v-model="message"
          label="Message"
          placeholder="Optional description"
          :monospace="false"
        />
        <FormCheck
          v-model="stagedOnly"
          label="Only what is staged"
          hint="`--staged`: needs git 2.35 or later."
        />
        <FormCheck
          v-model="includeUntracked"
          label="Include untracked files"
          :disabled="stagedOnly"
          hint="`-u`: otherwise new files stay behind."
        />
        <FormCheck
          v-model="keepIndex"
          label="Leave staged changes staged"
          :disabled="stagedOnly"
          hint="`--keep-index`: puts the staged half back."
        />

        <CommandPreview :argv="saveArgv" placeholder="Nothing to stash" />
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
      <button class="primary" :disabled="busy || !dirty" @click="stash">
        {{ busy ? 'Stashing…' : 'Stash' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
.stash {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  height: 100%;
}

/* A set height rather than the space left over: this window is `fixedHeight`, and the
   form under the pair is what the rest of it is for. Quieter border with it: here the
   pair is one control among several, not the whole window. */
.split {
  flex: none;
  height: 340px;
  border-color: var(--border-subtle);
}
</style>
