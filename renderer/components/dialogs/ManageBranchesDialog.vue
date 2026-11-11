<script setup lang="ts">
/**
 * The local branches: a list you pick one or several out of, beside a pane that acts on
 * the pick. Deleting takes the whole pick in one `git branch --delete`; checking out,
 * renaming and setting an upstream take one branch and open the dialog that already does
 * each, so none of the three is written a second time here.
 *
 * Stays open, like the other managers: a delete passes `{ close: false }`, and the list
 * is the ref list every dialog window already reloads when the repository moves.
 */

import { computed } from 'vue';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useBranchDeletion } from '@renderer/composables/useBranchDeletion.js';
import { useTreePicks } from '@renderer/composables/useTreePicks.js';
import type { FileRow } from '@renderer/filetree.js';
import { branchStates, deletable, mergedNames } from '@renderer/model/branchManager.js';
import { shortSha } from '@renderer/model/sha.js';
import type { DialogName, DialogPayload } from '@shared/dialogs.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DeleteButton from '@renderer/components/ui/DeleteButton.vue';
import CodeText from '@renderer/components/ui/CodeText.vue';
import TreePickList from '@renderer/components/dialogs/parts/TreePickList.vue';
import ForceDeleteBranches from '@renderer/components/dialogs/parts/ForceDeleteBranches.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';
import { REF_KIND_BRANCH, type RefEntry } from '@shared/types.js';

const props = defineProps<{
  /** A branch to have picked when the window opens: a branch row's own Manage names it. */
  branchName?: string;
  /** A folder of branches to have picked, as `author/`: a panel folder's Manage names it. */
  branchFolder?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const objects = useRepoObjectsStore();
const ui = useUiStore();
const { busy, error, run, close } = useDialog();

const branches = computed(() => objects.refs.filter((entry) => entry.kind === REF_KIND_BRANCH));

/** What the payload named, read once: the refs are loaded before a dialog mounts. */
function initialPicks(): string[]
{
  const folder = props.branchFolder;
  if (folder)
  {
    return branches.value.filter((entry) => entry.name.startsWith(folder)).map((entry) => entry.name);
  }
  if (props.branchName)
  {
    return [props.branchName];
  }
  return [];
}

/** A branch as the tree folds it: its name is its path. */
interface BranchEntry {
  path: string;
  ref: RefEntry;
}

const entries = computed<BranchEntry[]>(() =>
  branches.value.map((entry) => ({ path: entry.name, ref: entry }))
);

// Not dense: the panel draws `feature/ui/` as two levels, and so does this.
const { rows, picks, isPicked, pickRow, pickKeys, toggleFolder } = useTreePicks(entries, {
  initial: initialPicks(),
  dense: false
});

const picked = computed(() => branches.value.filter((entry) => picks.value.has(entry.name)));

/** The one branch the single-branch actions are about, or null when the pick is not one. */
const single = computed(() =>
{
  if (picked.value.length === 1)
  {
    return picked.value[0]!;
  }
  return null;
});

const toDelete = computed(() => deletable(picked.value));

const checkedOut = computed(() => picked.value.find((entry) => entry.isCurrent) ?? null);

const { force, unmerged, argv, wouldBeRefused, deleteLabel, isMerged } = useBranchDeletion(toDelete);

const merged = computed(() => mergedNames(branches.value, isMerged));

function detailOf(row: FileRow<BranchEntry>): string
{
  if (!row.file)
  {
    return '';
  }
  return branchStates(row.file.ref, isMerged(row.file.ref)).join(' · ');
}

/** Open the dialog that does one thing to one branch. */
function openFor(name: DialogName, payload: DialogPayload): void
{
  ui.openDialog(name, payload);
}

const pickSummary = computed(() =>
{
  if (picked.value.length === 0)
  {
    return 'Pick a branch. Cmd-click or Shift-click picks several; a folder picks all of it.';
  }
  return `${picked.value.length} branches picked.`;
});

const keptNote = computed(() =>
{
  if (!checkedOut.value)
  {
    return '';
  }
  return `\`${checkedOut.value.name}\` is checked out, so it is not deleted.`;
});

async function remove(): Promise<void>
{
  if (await run(argv.value, REFS, { close: false }))
  {
    force.value = false;
  }
}
</script>

<template>
  <DialogFrame title="Manage Branches" fixed-height @close="emit('close')">
    <div class="split">
      <TreePickList
        :rows="rows"
        :is-picked="isPicked"
        empty="No local branches."
        @pick="pickRow"
        @toggle="toggleFolder"
      >
        <template #detail="{ row }">
          <span v-if="row.file?.ref.upstream || detailOf(row)" class="detail truncate">
            <code v-if="row.file?.ref.upstream">{{ row.file.ref.upstream }}</code>
            <template v-if="row.file?.ref.upstream && detailOf(row)"> · </template>
            {{ detailOf(row) }}
          </span>
        </template>
      </TreePickList>

      <div class="detail-pane">
        <div class="form">
          <dl v-if="single">
            <dt>Branch</dt>
            <dd>{{ single.name }}</dd>
            <dt>Tip</dt>
            <dd>{{ shortSha(single.sha) }}</dd>
            <dt>Upstream</dt>
            <dd>{{ single.upstream ?? 'none' }}</dd>
          </dl>
          <p v-else class="hint">{{ pickSummary }}</p>

          <p v-if="keptNote" class="hint"><CodeText :text="keptNote" /></p>

          <ForceDeleteBranches v-model="force" :unmerged="unmerged" />

          <CommandPreview :argv="argv" placeholder="Pick a branch that is not checked out" />
          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <!-- Always drawn, disabled where they do not apply, so picking a second branch
             does not take a row of buttons out of the pane and resize the window. -->
        <div class="actions">
          <button
            :disabled="busy || !single || single.isCurrent"
            @click="openFor('branch.checkout', { ref: single?.name })"
          >
            Checkout…
          </button>
          <button
            :disabled="busy || !single"
            @click="openFor('branch.rename', { branchName: single?.name })"
          >
            Rename…
          </button>
          <button
            :disabled="busy || !single"
            @click="openFor('branch.setUpstream', { branchName: single?.name })"
          >
            Set Upstream…
          </button>
          <span class="spacer" />
          <button :disabled="busy || !merged.length" @click="pickKeys(merged)">Select Merged</button>
        </div>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
      <DeleteButton
        class="danger"
        :disabled="busy || !toDelete.length || wouldBeRefused"
        @click="remove"
      >
        {{ busy ? 'Deleting…' : deleteLabel }}
      </DeleteButton>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>
<style scoped src="@renderer/styles/factList.css"></style>
<style scoped>
/* The list picks the operand and the pane acts on it: the remotes dialog's division. */
.side {
  flex: none;
  width: 260px;
}
</style>
