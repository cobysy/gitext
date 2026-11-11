<script setup lang="ts">
/**
 * The worktrees: a list you pick one or several out of, folded by directory, beside a
 * pane that acts on the pick. Deleting takes the whole pick, one `git worktree remove`
 * each; Open takes one. Pruning acts on the repository rather than the pick, so it sits
 * in the footer. Stays open, like the other managers.
 *
 * The main worktree is listed though it cannot be removed: it answers "which am I in?".
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import {
  buildWorktreePruneArgs,
  buildWorktreeDiscardSteps,
  DISCARD_TRASH,
  type WorktreeDiscardStep
} from '@renderer/model/args/worktree.js';
import { isRemovable, treeEntries, worktreeStates } from '@renderer/model/worktreeList.js';
import type { WorktreeEntry } from '@shared/types.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import type { FileRow } from '@renderer/filetree.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useTreePicks } from '@renderer/composables/useTreePicks.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DeleteButton from '@renderer/components/ui/DeleteButton.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import TreePickList from '@renderer/components/dialogs/parts/TreePickList.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { READS } from '@shared/invalidation.js';

const props = withDefaults(
  defineProps<{
    /** Open with this worktree picked: the panel's Delete Worktree row names one. */
    selectPath?: string;
  }>(),
  { selectPath: '' }
);

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, run, perform, close } = useDialog();

const objects = useRepoObjectsStore();

/** The list every dialog window keeps and reloads when the repository moves, so a worktree added or removed anywhere shows here. */
const worktrees = computed(() => objects.worktrees);
const force = ref(false);
/** What the last prune preview printed. */
const prunePreview = ref<string | null>(null);

const openPath = computed(() => repo.repo?.path ?? null);

const tree = computed(() => treeEntries(worktrees.value));
const entries = computed(() => tree.value.entries);

/** The payload's worktree, as its key in the tree: the list is loaded before a dialog mounts. */
function initialPicks(): string[]
{
  const named = entries.value.find((entry) => entry.worktree.path === props.selectPath);
  if (named)
  {
    return [named.path];
  }
  return [];
}

const { rows, picks, isPicked, pickRow, toggleFolder } = useTreePicks(entries, {
  initial: initialPicks(),
  // Dense: a directory of worktrees nested a few levels down is one row, not a chain.
  dense: true
});

const picked = computed(() =>
  entries.value.filter((entry) => picks.value.has(entry.path)).map((entry) => entry.worktree)
);

const single = computed(() =>
{
  if (picked.value.length === 1)
  {
    return picked.value[0]!;
  }
  return null;
});

const toRemove = computed(() => picked.value.filter((entry) => isRemovable(entry, openPath.value)));

const kept = computed(() => picked.value.filter((entry) => !isRemovable(entry, openPath.value)));

const steps = computed(() =>
  buildWorktreeDiscardSteps(
    toRemove.value.map((entry) => entry.path),
    force.value
  )
);

const prunable = computed(() => worktrees.value.filter((entry) => entry.prunable));

function detailOf(row: FileRow<{ path: string; worktree: WorktreeEntry }>): string
{
  if (!row.file)
  {
    return '';
  }
  return worktreeStates(row.file.worktree, openPath.value).join(' · ');
}

const deleteLabel = computed(() =>
{
  if (toRemove.value.length > 1)
  {
    return `Delete ${toRemove.value.length} Worktrees`;
  }
  return 'Delete';
});

const pickSummary = computed(() =>
{
  if (picked.value.length === 0)
  {
    return 'Pick a worktree. Cmd-click or Shift-click picks several; a folder picks all of it.';
  }
  return `${picked.value.length} worktrees picked.`;
});

/** What the pane says about the one worktree picked. */
const singleNote = computed(() =>
{
  const entry = single.value;
  if (!entry)
  {
    return '';
  }
  if (entry.isMain)
  {
    return 'The repository\'s own working directory. It cannot be removed from here.';
  }
  if (entry.path === openPath.value)
  {
    return 'Open in this window. Open another first to remove it.';
  }
  if (entry.prunable)
  {
    return 'Its directory is gone. Prune forgets the record.';
  }
  return 'Deleting it removes the directory; the branch stays.';
});

const keptNote = computed(() =>
{
  if (single.value || kept.value.length === 0)
  {
    return '';
  }
  if (kept.value.length === 1)
  {
    return 'One of them cannot be removed from here, so it is left.';
  }
  return `${kept.value.length} of them cannot be removed from here, so they are left.`;
});

/** Open it in the window behind this one: see `repo:openHere`. */
async function open(path: string): Promise<void>
{
  await perform('Opening the worktree', async () => api['repo:openHere'](path), {
    refresh: false
  });
}

/** One step of a delete: the move through its own channel, the record through git. */
async function runDiscardStep(repoPath: string, step: WorktreeDiscardStep): Promise<void>
{
  if (step.kind === DISCARD_TRASH)
  {
    await api['worktree:trash'](repoPath, step.path, step.force);
    return;
  }
  await api['git:run'](repoPath, step.argv, ['worktrees']);
}

async function remove(): Promise<void>
{
  if (steps.value.length === 0)
  {
    return;
  }

  let title: string;
  if (toRemove.value.length === 1)
  {
    title = `Delete the worktree at ${toRemove.value[0]!.path}?`;
  }
  else
  {
    title = `Delete ${toRemove.value.length} worktrees?`;
  }
  let message: string;
  if (force.value)
  {
    message = 'The folders go to the Trash, uncommitted work and all.';
  }
  else
  {
    message = 'The folders go to the Trash; their branches stay.';
  }
  const ok = await ui.confirm({ title, message, confirmLabel: 'Delete', danger: true, deletes: true });
  if (!ok)
  {
    return;
  }

  const plan = steps.value;
  const done = await perform(
    'Deleting the worktrees',
    async (repoPath, watcher) =>
    {
      for (const [index, step] of plan.entries())
      {
        watcher.started({ label: step.label, argv: step.argv, index, count: plan.length, stop: null });
        await runDiscardStep(repoPath, step);
      }
    },
    { close: false }
  );
  if (done)
  {
    force.value = false;
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
  }
}
</script>

<template>
  <DialogFrame title="Manage Worktrees" fixed-height @close="emit('close')">
    <div class="split">
      <div class="side-column">
        <p class="base truncate" :title="tree.base">{{ tree.base }}</p>
        <TreePickList
          :rows="rows"
          :is-picked="isPicked"
          empty="No worktrees."
          @pick="pickRow"
          @toggle="toggleFolder"
        >
          <template #detail="{ row }">
            <span class="detail truncate">
              <code v-if="row.file?.worktree.branch">{{ row.file.worktree.branch }}</code>
              <template v-if="row.file?.worktree.branch && detailOf(row)"> · </template>
              {{ detailOf(row) }}
            </span>
          </template>
        </TreePickList>
      </div>

      <div class="detail-pane">
        <div class="form">
          <p v-if="single" class="hint">{{ singleNote }}</p>
          <p v-else class="hint">{{ pickSummary }}</p>
          <p v-if="keptNote" class="hint">{{ keptNote }}</p>

          <FormCheck
            v-model="force"
            label="Delete them even with uncommitted changes in them"
            hint="Otherwise one with changes is refused."
            :disabled="!toRemove.length"
          />

          <CommandPreview :steps="steps" placeholder="Pick a worktree that can be removed" />
          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <!-- Always drawn, disabled where they do not apply, so the pane keeps its height. -->
        <div class="actions">
          <button
            :disabled="busy || !single || single.path === openPath"
            @click="single && open(single.path)"
          >
            Open
          </button>
          <DeleteButton class="del" :disabled="busy || !steps.length" @click="remove">
            {{ deleteLabel }}
          </DeleteButton>
        </div>

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
/* The list picks the operand and the pane acts on it: the remotes dialog's division. */
.side-column {
  width: 260px;
}

/* Where every worktree lives, so the rows below can name only what differs. */
.base {
  margin: 0;
  font-family: var(--font-mono);
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
