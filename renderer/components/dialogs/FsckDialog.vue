<script setup lang="ts">
/**
 * Objects the repository still holds that nothing points at: the window `repo.fsck`
 * opens, with more of the object database in view than a reflog can show.
 *
 * **The three checkboxes are the whole difficulty here, and `--no-reflogs` is the one
 * that matters.** git treats reflog entries as roots reaching everything from the last
 * ninety days, so a commit thrown away with `reset --hard` thirty seconds ago is still
 * reachable and fsck says nothing about it. Opens with `--unreachable --no-reflogs` already ticked.
 *
 * A browse window: `fixedHeight`, a list beside a pane, the shape `ManageRemotesDialog`
 * established. Every action passes `{ close: false }` and re-reads the list, since
 * recovering is several gestures in a row.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { registerCommands } from '@renderer/commands/index.js';
import { buildFsckArgs, type FsckOptions } from '@shared/fsck.js';
import { buildPruneArgs } from '@renderer/model/args/maintenance.js';
import { OBJECT_KIND_COMMIT } from '@renderer/model/lostObject.js';
import { REFS } from '@shared/invalidation.js';
import type { LostObject } from '@shared/types.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import LostObjectPreview from './parts/LostObjectPreview.vue';

const emit = defineEmits<{ close: [] }>();

// The preview draws a commit with `ChangedFiles` and `DiffViewer`, resolving their own
// menus through the registry, which a dialog window otherwise has none of. Idempotent per window.
registerCommands();

const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, run, runSteps, perform } = useDialog();

/** The prefix recovery tags are written under. */
const LOST_FOUND_PREFIX = 'LOST_FOUND_';

// Both ticked on open: see the note above. `full` is not: it reads every packed object,
// which on a large repository is a long wait for an answer the loose objects usually hold.
const unreachable = ref(true);
const noReflogs = ref(true);
const full = ref(false);

const options = computed<FsckOptions>(() => ({
  unreachable: unreachable.value,
  full: full.value,
  noReflogs: noReflogs.value
}));

const argv = computed(() => buildFsckArgs(options.value));

const objects = ref<LostObject[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const selectedSha = ref<string | null>(null);

/** The rows the user has ticked for bulk recovery. Keyed by SHA, which is the identity. */
const picked = ref<Set<string>>(new Set());

/**
 * Commits first, newest first; everything else after, in git's own order. git emits
 * its report in object-database order, which puts trees and blobs above the commit
 * anybody came here for: the recoverable thing, with a message and a branch/tag to point at it.
 */
const ordered = computed<LostObject[]>(() =>
{
  const rank = (object: LostObject): number =>
  {
    if (object.kind === OBJECT_KIND_COMMIT)
    {
      return 0;
    }
    else
    {
      return 1;
    }
  };
  return [...objects.value].sort(
    (a, b) => rank(a) - rank(b) || (b.date ?? 0) - (a.date ?? 0)
  );
});

const selected = computed(() => objects.value.find((o) => o.sha === selectedSha.value) ?? null);

/** Only a commit can be branched from or tagged; a loose blob has no history to stand in. */
const selectedIsCommit = computed(() => selected.value?.kind === OBJECT_KIND_COMMIT);

const pickedCommits = computed(() =>
  objects.value.filter((o) => o.kind === OBJECT_KIND_COMMIT && picked.value.has(o.sha))
);

function shortSha(sha: string): string
{
  return sha.slice(0, 8);
}

function describe(object: LostObject): string
{
  let when;
  if (object.date)
  {
    when = new Date(object.date * 1000).toLocaleDateString();
  }
  else
  {
    when = null;
  }
  return [object.state, when, object.author].filter(Boolean).join(' · ');
}

async function load(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  loading.value = true;
  loadError.value = null;
  try
  {
    const found = await api['repo:fsck'](path, options.value);
    objects.value = found;
    // Keep the selection if the same object is still listed: ticking `--full` should not
    // throw away the commit somebody was reading.
    if (!found.some((o) => o.sha === selectedSha.value))
    {
      // The first row *as drawn*, not as git listed it: `ordered` puts commits on top.
      selectedSha.value = ordered.value[0]?.sha ?? null;
    }
    // Ticks drop for anything no longer there, rather than kept as SHAs the list can't show.
    picked.value = new Set([...picked.value].filter((sha) => found.some((o) => o.sha === sha)));
  }
  catch (err)
  {
    loadError.value = toMessage(err);
    objects.value = [];
  }
  finally
  {
    loading.value = false;
  }
}

// Re-read on every option change: each checkbox is a different question, and a list that
// stayed put while the flags moved would be answering the previous one.
watch(options, () => void load(), { deep: true });
onMounted(() => void load());

function togglePick(sha: string): void
{
  const next = new Set(picked.value);
  if (next.has(sha))
  {
    next.delete(sha);
  }
  else
  {
    next.add(sha);
  }
  picked.value = next;
}

// ── Recovery ──────────────────────────────────────────────────────────────────

/** Branch and tag both reuse the dialogs that already exist, with the lost SHA as operand. */
function createBranch(): void
{
  if (selected.value)
  {
    ui.openDialog('branch.create', { sha: selected.value.sha });
  }
}

function createTag(): void
{
  if (selected.value)
  {
    ui.openDialog('tag.create', { sha: selected.value.sha });
  }
}

/**
 * Tag every ticked commit as `LOST_FOUND_<sha>`. Tags, not branches: forty
 * `LOST_FOUND_` branches would flood the left panel, and the next button can delete these tags in one gesture.
 */
async function restorePicked(): Promise<void>
{
  const commits = pickedCommits.value;
  if (commits.length === 0)
  {
    return;
  }

  await runSteps(
    commits.map((commit) => ({
      label: `Tagging ${shortSha(commit.sha)}`,
      argv: ['tag', `${LOST_FOUND_PREFIX}${commit.sha}`, commit.sha]
    })),
    REFS,
    { close: false }
  );
  picked.value = new Set();
  await load();
}

/** The inverse, so the tags above are never something you are stuck with. */
async function deleteLostFoundTags(): Promise<void>
{
  // `perform` reports success as a boolean, so the list comes out through a ref rather than
  // a return value: the same shape `CleanDialog` uses for its dry run.
  let tags: string[] = [];
  const listed = await perform(
    'Listing the recovery tags',
    async (repoPath) =>
    {
      const output = await api['git:run'](repoPath, ['tag', '--list', `${LOST_FOUND_PREFIX}*`], []);
      tags = output
        .split('\n')
        .map((tag) => tag.trim())
        .filter(Boolean);
    },
    { close: false, refresh: false }
  );
  if (!listed)
  {
    return;
  }

  if (tags.length === 0)
  {
    ui.toast('There are no `LOST_FOUND_` tags to delete.');
    return;
  }

  let noun: string;
  if (tags.length === 1)
  {
    noun = 'tag';
  }
  else
  {
    noun = 'tags';
  }
  const ok = await ui.confirm({
    title: `Delete ${tags.length} recovery ${noun}?`,
    message:
      'Removes the `LOST_FOUND_` tags. The commits become unreachable again.',
    confirmLabel: 'Delete them',
    danger: true
  });
  if (!ok)
  {
    return;
  }

  await run(['tag', '-d', ...tags], REFS, { close: false });
  await load();
}

/**
 * `fsck --lost-found`: writes every lost object into `.git/lost-found/` as a real file,
 * the recovery route for objects a tag can't help with (a blob has no commit to check
 * out). Watched in the console, like every other command that prints as it works: it
 * names each object it wrote, which is the list you came for.
 */
async function saveToLostFound(): Promise<void>
{
  await perform(
    'Saving to lost-found',
    async (repoPath) =>
    {
      // `keepOpen`: it names every object it wrote into `.git/lost-found/`, and that
      // list is what you came for, not progress towards something else.
      await runConsoleSteps(
        repoPath,
        [{ label: 'git fsck --lost-found', argv: buildFsckArgs({ ...options.value, lostFound: true }) }],
        [],
        { console: true, keepOpen: true }
      );
    },
    { close: false, refresh: false }
  );
}

/**
 * `git prune`: the irreversible one. A plain confirmation with no `rememberKey`, like
 * the clean dialog's: after this, the objects are gone and nothing anywhere holds a copy.
 */
async function prune(): Promise<void>
{
  const ok = await ui.confirm({
    title: 'Delete every unreachable object?',
    message:
      '`git prune` deletes them. Anything untagged is gone for good.',
    confirmLabel: 'Delete them',
    danger: true
  });
  if (!ok)
  {
    return;
  }

  await run(buildPruneArgs(), ['commits'], { close: false });
  await load();
}

</script>

<template>
  <DialogFrame title="Recover Lost Objects" fixed-height @close="emit('close')">
    <div class="split">
      <div class="side-column">
        <div class="options">
          <FormCheck
            v-model="unreachable"
            label="Include unreachable objects"
            hint="`--unreachable`: the commits behind a lost tip too."
          />
          <FormCheck
            v-model="noReflogs"
            label="Ignore the reflog"
            hint="`--no-reflogs`: otherwise the reflog hides most losses."
          />
          <FormCheck
            v-model="full"
            label="Check packed objects too"
            hint="`--full`: slower, and rarely what finds a lost commit."
          />
        </div>

        <ul class="list side">
          <li v-if="loading" class="placeholder">Checking the object database…</li>
          <li v-else-if="loadError" class="placeholder error">{{ loadError }}</li>
          <li v-else-if="objects.length === 0" class="placeholder">
            Nothing is lost. Every object in this repository is reachable.
          </li>
          <template v-else>
            <li v-for="object in ordered" :key="object.sha">
              <div class="row" :class="{ current: selectedSha === object.sha }">
                <span class="tick">
                  <input
                    v-if="object.kind === OBJECT_KIND_COMMIT"
                    type="checkbox"
                    :checked="picked.has(object.sha)"
                    :aria-label="`Select ${shortSha(object.sha)} for recovery`"
                    @change="togglePick(object.sha)"
                  />
                </span>
                <button class="entry" @click="selectedSha = object.sha">
                  <!-- A subject is prose and a SHA is a token: an object with no message
                       is identified by its hash, so the hash is set in the code font
                       rather than left to read as a word. -->
                  <span v-if="object.subject" class="title truncate">{{ object.subject }}</span>
                  <span v-else class="title truncate">
                    {{ object.kind }} <code>{{ shortSha(object.sha) }}</code>
                  </span>
                  <span class="detail truncate">{{ describe(object) }}</span>
                </button>
              </div>
            </li>
          </template>
        </ul>
      </div>

      <div class="detail-pane dense">
        <div class="bar">
          <span class="truncate">
            <template v-if="selected">
              {{ selected.kind }} <code>{{ shortSha(selected.sha) }}</code>
            </template>
            <template v-else>Nothing selected</template>
          </span>
          <span class="spacer" />
          <button :disabled="!selectedIsCommit || busy" @click="createBranch">
            Create Branch…
          </button>
          <button :disabled="!selectedIsCommit || busy" @click="createTag">Create Tag…</button>
        </div>

        <LostObjectPreview :object="selected" :repo-path="repo.repo?.path" />

        <CommandPreview :argv="argv" />
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>

    <!-- No Close button: this is `fullWindow`, so it opens with the frame's own ✕, and
         Escape closes it like every dialog. A fifth button doing nothing new would crowd
         out the four that act, two of which delete things. -->
    <template #actions>
      <button :disabled="busy" @click="deleteLostFoundTags">Delete Recovery Tags</button>
      <button :disabled="busy" @click="saveToLostFound">
        Save to <code>.git/lost-found</code>
      </button>
      <button class="danger" :disabled="busy" @click="prune">Delete Unreachable…</button>
      <button
        class="primary"
        :disabled="busy || pickedCommits.length === 0"
        @click="restorePicked"
      >
        Tag {{ pickedCommits.length || '' }} Selected
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>

<style scoped>

.side-column {
  width: 320px;
}

.options {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/*
 * A tick beside each row, not a multi-selection: elsewhere picking and looking are the
 * same click (`pathSelection.ts`), but here the pane shows whatever was clicked last, so
 * ticking forty commits would fight the same click. The cell, not the checkbox, owns the
 * width, so an empty row's blank space doesn't drift from the platform's own checkbox sizing.
 */
.tick {
  flex: none;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tick input {
  margin: 0;
}

.row {
  display: flex;
  align-items: center;
}

.row.current {
  background: var(--bg-selected);
}

.row .entry {
  flex: 1;
  min-width: 0;
}

.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

</style>
