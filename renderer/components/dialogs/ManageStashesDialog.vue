<script setup lang="ts">
/**
 * The stashes you have, and what to do with one: a list that picks the stash beside the
 * diff it holds, with Apply, Pop and Drop under it.
 *
 * Its own window rather than a row in the save dialog. Saving and managing are different
 * questions, and a window that answers both by *selecting* between them opens on the save
 * form whenever there is nothing stashed yet: which is exactly when someone opening
 * "Manage Stashes" is most sure the app ignored the row they clicked.
 *
 * `ChangedFiles` and `DiffViewer` are pointed at the stash's range through `diff.setRange`,
 * the same mechanism the compare dialog uses.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { buildStashApplyArgs, buildStashDropArgs } from '@renderer/model/args/stash.js';
import { formatCommitDate } from '@renderer/format.js';
import type { DiffRange } from '@shared/diff.js';
import type { StashEntry } from '@shared/types.js';
import { registerCommands } from '@renderer/commands/index.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import RepoFilePanes from '@renderer/components/dialogs/parts/RepoFilePanes.vue';

// A dialog window otherwise starts with none of the command registry: `DialogHost`
// never calls `useCommands()`, but the panes below resolve their own menus and commands
// through it regardless of window. Idempotent per window.
registerCommands();

const props = defineProps<{
  /** A stash to select on open: from the left panel, or the grid's stash row. */
  stashRef?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const settings = useSettingsStore();
const ui = useUiStore();
const diff = useDiffStore();
// Stays open: this is a list you keep working in, so every action passes `{ close: false }`
// and reloads rather than closing the window out from under the next decision.
const { busy, error, run, close } = useDialog();

const stashes = ref<StashEntry[]>([]);
const loading = ref(true);
const selected = ref<string | null>(props.stashRef ?? null);
const restoreIndex = ref(false);

const current = computed(
  () => stashes.value.find((entry) => entry.name === selected.value) ?? null
);

/** What a stash's own diff is: against the parent it was taken from, which is what
 * `git stash show` is under its own name. A stash saved with `-u` also carries a *third*
 * parent for untracked files, but the main commit's tree already holds their content,
 * so a plain diff against the first parent shows them without needing that parent. */
function rangeFor(ref: string): DiffRange
{
  return { from: { kind: 'commit', sha: `${ref}^1` }, to: { kind: 'commit', sha: ref } };
}

/**
 * Nothing selected is `null`, not a range that shows nothing: `buildDiffArgs` refuses two
 * identical endpoints, so `HEAD` against `HEAD` is an error thrown in main rather than an
 * empty list. The store fetches whenever the range changes, whether or not the panes that
 * read it are on screen, so this runs on the first frame of a repository with no stashes.
 */
watch(
  selected,
  (ref) =>
  {
    if (ref)
    {
      diff.setRange(rangeFor(ref));
    }
    else
    {
      diff.setRange(null);
    }
  },
  { immediate: true }
);

function describe(entry: StashEntry): string
{
  return `${entry.name} · ${formatCommitDate(entry.date, settings.settings.dateFormat)}`;
}

const applyArgv = computed(() =>
{
  if (selected.value)
  {
    return buildStashApplyArgs({ ref: selected.value, restoreIndex: restoreIndex.value });
  }
  else
  {
    return [];
  }
});

async function loadStashes(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  try
  {
    stashes.value = await api['stash:list'](path);
  }
  catch (err)
  {
    error.value = toMessage(err);
  }
  finally
  {
    loading.value = false;
  }
  // The stash that was selected may have just been popped or dropped, and the one a
  // payload named may belong to a repository this window is not open on: either way the
  // newest is the row to fall back to, and `null` when there is no row at all.
  if (!stashes.value.some((entry) => entry.name === selected.value))
  {
    selected.value = stashes.value[0]?.name ?? null;
  }
}

async function applyStash(pop: boolean): Promise<void>
{
  if (!selected.value)
  {
    return;
  }
  const argv = buildStashApplyArgs({
    ref: selected.value,
    pop,
    restoreIndex: restoreIndex.value
  });
  if (!(await run(argv, ['stashes', 'worktree', 'index'], { close: false })))
  {
    return;
  }
  await loadStashes();
}

async function dropStash(): Promise<void>
{
  const entry = current.value;
  if (!entry)
  {
    return;
  }
  const confirmed = await ui.confirmUnlessSuppressed({
    title: 'Drop this stash?',
    message: `${entry.message}\n\nA dropped stash is in the reflog of no branch and is hard to recover.`,
    confirmLabel: 'Drop it',
    danger: true,
    rememberKey: 'stash.drop'
  });
  if (!confirmed)
  {
    return;
  }
  if (!(await run(buildStashDropArgs(entry.name), ['stashes'], { close: false })))
  {
    return;
  }
  await loadStashes();
}

/** The other half of the subject, in the window that owns it: this one never saves. */
function stashChanges(): void
{
  ui.openDialog('stash');
}

onMounted(async () =>
{
  // This window always shows *changed* files, never "browse the tree at a revision".
  // Direct assignment, not `settings.patch(...)`: that persists and broadcasts to every
  // open window, and opening this dialog must not silently flip the main window's
  // preference.
  settings.settings.filesPaneMode = 'changed';
  await repo.refresh();
  await loadStashes();
});
</script>

<template>
  <DialogFrame title="Manage Stashes" fixed-height @close="emit('close')">
    <div class="split">
      <ul class="list side">
        <li v-if="loading" class="placeholder">Reading the stashes…</li>
        <li v-else-if="stashes.length === 0" class="placeholder">
          Nothing is stashed. Saved changes appear here.
        </li>
        <li v-for="entry in stashes" v-else :key="entry.name">
          <button
            class="entry"
            :class="{ current: selected === entry.name }"
            @click="selected = entry.name"
          >
            <span class="title truncate" :title="entry.message">{{ entry.message }}</span>
            <span class="detail truncate">{{ describe(entry) }}</span>
          </button>
        </li>
      </ul>

      <div class="detail-pane dense">
        <template v-if="current">
          <RepoFilePanes />

          <FormCheck
            v-model="restoreIndex"
            label="Restore what was staged as staged"
            hint="`--index`: refuses rather than falling back."
          />
          <CommandPreview :argv="applyArgv" />
        </template>

        <div v-else class="form">
          <p class="placeholder">
            No stash is selected. Stashing puts your changes aside and gives you a clean
            working tree.
          </p>
          <div class="actions">
            <button :disabled="busy" @click="stashChanges">Stash Changes…</button>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
      <button class="danger" :disabled="busy || !current" @click="dropStash">Drop</button>
      <button :disabled="busy || !current" @click="applyStash(false)">Apply</button>
      <button class="primary" :disabled="busy || !current" @click="applyStash(true)">
        Pop
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>
<style scoped>
/* Wide enough for a stash's message rather than its first three words: the list is what
   tells one stash from another, and every row here is prose. */
.list.side {
  flex: none;
  width: 300px;
}

.placeholder {
  padding: var(--space-3);
}
</style>
