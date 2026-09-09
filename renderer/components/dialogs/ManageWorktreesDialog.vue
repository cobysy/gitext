<script setup lang="ts">
/**
 * Worktree list: open, delete, or prune (stay open, same as remotes/stash dialogs).
 * Main worktree in list (cannot be removed; answers "which am I in?").
 */

import { computed, onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';
import {
  buildWorktreePruneArgs,
  buildWorktreeRemoveArgs
} from '@renderer/model/args/worktree.js';
import type { WorktreeEntry } from '@shared/types.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { READS } from '@shared/invalidation.js';

const props = withDefaults(
  defineProps<{
    /** Open with this row selected: the panel's Delete Worktree row names one. */
    selectPath?: string;
  }>(),
  { selectPath: '' }
);

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, run, perform, close } = useDialog();

const worktrees = ref<WorktreeEntry[]>([]);
const loading = ref(true);
const selected = ref<string | null>(props.selectPath || null);
const force = ref(false);
/** What the last prune preview printed. */
const prunePreview = ref<string | null>(null);

const current = computed(() =>
  worktrees.value.find((entry) => entry.path === selected.value) ?? null
);

/** The one you are in. Its row is marked and its Delete is refused by git anyway. */
const isCurrent = computed(() => current.value?.path === repo.repo?.path);

/** True when `entry` is a worktree `git worktree remove` can actually be asked to drop. */
function isRemovable(entry: WorktreeEntry | null, isCurrent: boolean): entry is WorktreeEntry
{
  return !!entry && !entry.isMain && !isCurrent;
}

const removeArgv = computed(() =>
{
  if (isRemovable(current.value, isCurrent.value))
  {
    return buildWorktreeRemoveArgs({ path: current.value.path, force: force.value });
  }
  else
  {
    return [];
  }
}
);

const prunable = computed(() => worktrees.value.filter((entry) => entry.prunable));

async function load(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  loading.value = true;
  try
  {
    worktrees.value = await api['worktree:list'](path);
    if (!worktrees.value.some((entry) => entry.path === selected.value))
    {
      selected.value = worktrees.value[0]?.path ?? null;
    }
  }
  finally
  {
    loading.value = false;
  }
}

/** Open it in the window behind this one: see `repo:openHere`. */
async function open(path: string): Promise<void>
{
  await perform('Opening the worktree', async () => api['repo:openHere'](path), {
    refresh: false
  });
}

async function remove(): Promise<void>
{
  const entry = current.value;
  if (!entry || removeArgv.value.length === 0)
  {
    return;
  }

  let message: string;
  if (force.value)
  {
    message =
      'The directory and any uncommitted work in it are deleted.';
  }
  else
  {
    message =
      'The directory is deleted; the branch it had checked out stays.';
  }
  const ok = await ui.confirm({
    title: `Delete the worktree at ${entry.path}?`,
    message,
    confirmLabel: 'Delete it',
    danger: true
  });
  if (!ok)
  {
    return;
  }

  if (await run(removeArgv.value, ['worktrees'], { close: false }))
  {
    await load();
  }
}

/** What prune would forget, before it forgets it. */
async function previewPrune(): Promise<void>
{
  prunePreview.value = null;
  await perform(
    'Previewing the prune',
    async (repoPath) =>
    {
      const out = await api['git:run'](repoPath, buildWorktreePruneArgs({ dryRun: true }), READS);
      prunePreview.value = out.trim() || 'Nothing to prune.';
    },
    { close: false, refresh: false }
  );
}

async function prune(): Promise<void>
{
  if (await run(buildWorktreePruneArgs(), ['worktrees'], { close: false }))
  {
    prunePreview.value = null;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <DialogFrame title="Manage Worktrees" fixed-height @close="emit('close')">
    <div class="split">
      <ul class="list side">
        <li v-for="entry in worktrees" :key="entry.path">
          <button
            class="entry"
            :class="{ current: selected === entry.path }"
            @click="selected = entry.path"
          >
            <span class="title truncate" :title="entry.path">{{ entry.path }}</span>
            <span class="detail">
              <!-- The branch is a ref and the two fallbacks are states, so only the ref
                   is set as one. -->
              <code v-if="entry.branch">{{ entry.branch }}</code>
              <template v-else>{{ entry.isDetached ? 'detached' : 'no branch' }}</template>
              <template v-if="entry.isMain"> · the repository</template>
              <!-- Both, not one or the other: the main worktree is usually also the one
                   this window has open, and which of the two you wanted to know is not
                   for the list to decide. -->
              <template v-if="entry.path === repo.repo?.path"> · you are here</template>
              <template v-if="entry.isLocked"> · locked</template>
              <template v-if="entry.prunable"> · missing</template>
            </span>
          </button>
        </li>
      </ul>

      <div class="detail-pane">
        <p v-if="loading" class="placeholder">Reading…</p>
        <template v-else-if="current">
          <div class="form">
            <p class="hint">
              <template v-if="current.isMain">
                The repository's own working directory. It cannot be removed from here.
              </template>
              <template v-else-if="isCurrent">
                Open on this window. Open another first to remove it.
              </template>
              <template v-else-if="current.prunable">
                Its directory is gone. Prune forgets the record.
              </template>
              <template v-else>
                {{ current.branch ? `On ${current.branch}.` : 'Detached.' }}
                Deleting it removes the directory; the branch stays.
              </template>
            </p>

            <FormCheck
              v-if="!current.isMain && !isCurrent"
              v-model="force"
              label="Delete it even with uncommitted changes in it"
              hint="`--force`: git refuses otherwise."
            />

            <CommandPreview
              :argv="removeArgv"
              placeholder="This worktree cannot be removed from here"
            />
            <p v-if="error" class="error">{{ error }}</p>
          </div>

          <div class="actions">
            <button
              :disabled="busy || isCurrent"
              @click="open(current.path)"
            >
              Open
            </button>
            <button class="del" :disabled="busy || !removeArgv.length" @click="remove">
              Delete
            </button>
          </div>
        </template>

        <div class="form">
          <p v-if="prunable.length" class="warn">
            {{ prunable.length }}
            {{ prunable.length === 1 ? 'worktree has' : 'worktrees have' }} no directory any
            more. Pruning forgets them.
          </p>
          <pre v-if="prunePreview" class="output selectable">{{ prunePreview }}</pre>
        </div>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
      <button :disabled="busy" @click="previewPrune">Preview Prune</button>
      <button :disabled="busy" @click="prune">Prune</button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>
<style scoped>
/*
 * Truncate a path from the *left*.
 *
 * Every worktree of one repository shares a long prefix, so an ellipsis on the right cut
 * the only part that told them apart and drew two identical rows. `direction: rtl` moves
 * the ellipsis to the front; `unicode-bidi: plaintext` keeps the characters themselves in
 * their normal order, which a bare `rtl` would not.
 */
.entry .title {
  direction: rtl;
  unicode-bidi: plaintext;
  text-align: left;
}


/* The list picks the operand and the pane acts on it: the remotes dialog's division. */
.side {
  flex: none;
  width: 260px;
}

.title {
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  max-width: 100%;
}

.detail {
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

/* The dry run's output, as in the clean dialog: a list, in the font it was printed in. */
.output {
  margin: 0;
  padding: var(--space-2);
  max-height: 140px;
  overflow: auto;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}
</style>
