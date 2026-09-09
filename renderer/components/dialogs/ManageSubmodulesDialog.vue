<script setup lang="ts">
/**
 * Submodules in one window. All-submodules pseudo-entry (like stash dialog) makes bulk commands previewable.
 * Status column is its own read (walks into every submodule).
 */

import { computed, onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';
import {
  buildAddSubmoduleArgs,
  buildRemoveSubmoduleSteps,
  buildSyncSubmodulesArgs,
  buildUpdateSubmoduleArgs
} from '@renderer/model/args/submodule.js';
import {
  SUBMODULE_STATE_CONFLICTED,
  SUBMODULE_STATE_DIFFERENT_COMMIT,
  SUBMODULE_STATE_UNINITIALIZED,
  type SubmoduleEntry,
  type SubmoduleStatusEntry
} from '@shared/types.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const props = withDefaults(
  defineProps<{
    /** Open with this submodule selected: the panel's rows name one. */
    selectPath?: string;
  }>(),
  { selectPath: '' }
);

const emit = defineEmits<{ close: [] }>();


const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, run, runSteps, perform, close } = useDialog();

const submodules = ref<SubmoduleEntry[]>([]);
const status = ref<SubmoduleStatusEntry[]>([]);
const loading = ref(true);
/** The selected submodule's path, or null for the "all submodules" row. */
const selected = ref<string | null>(props.selectPath || null);
/** The "add one" row, which is a mode rather than a selection. */
const adding = ref(false);

// The add form.
const newUrl = ref('');
const newPath = ref('');
const newBranch = ref('');
const force = ref(false);
/** `--remote` on an update: take the branch head rather than the recorded commit. */
const fromRemote = ref(false);

const isAdding = computed(() => adding.value);
/** Nothing selected and not adding: the commands that act on every submodule at once. */
const isAll = computed(() => !adding.value && selected.value === null);

const current = computed(() =>
{
  if (adding.value)
  {
    return null;
  }
  else
  {
    return submodules.value.find((entry) => entry.path === selected.value) ?? null;
  }
}
);

function select(path: string | null): void
{
  adding.value = false;
  selected.value = path;
}

const currentStatus = computed(
  () => status.value.find((entry) => entry.path === selected.value) ?? null
);

/** What the row says under its name: its status, as a sentence. */
function describe(entry: SubmoduleEntry): string
{
  const state = status.value.find((item) => item.path === entry.path)?.state;
  if (state === SUBMODULE_STATE_UNINITIALIZED || !entry.initialized)
  {
    return 'not checked out';
  }
  if (state === SUBMODULE_STATE_DIFFERENT_COMMIT)
  {
    return 'at a different commit';
  }
  if (state === SUBMODULE_STATE_CONFLICTED)
  {
    return 'conflicted';
  }
  if (entry.branch)
  {
    return `tracking ${entry.branch}`;
  }
  else
  {
    return 'up to date';
  }
}

const addArgv = computed(() =>
  buildAddSubmoduleArgs({
    url: newUrl.value,
    path: newPath.value,
    branch: newBranch.value,
    force: force.value
  })
);

/** One submodule, or, on the "all" row, every one of them. */
const updateArgv = computed(() =>
{
  if (adding.value)
  {
    return [];
  }
  else
  {
    return buildUpdateSubmoduleArgs({ path: current.value?.path, remote: fromRemote.value });
  }
}
);

const syncArgv = computed(() =>
{
  if (adding.value)
  {
    return [];
  }
  else
  {
    return buildSyncSubmodulesArgs({ path: current.value?.path });
  }
}
);

const removeSteps = computed(() =>
{
  if (current.value)
  {
    return buildRemoveSubmoduleSteps(current.value.path);
  }
  else
  {
    return [];
  }
}
);

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
    const [list, states] = await Promise.all([
      api['submodule:list'](path),
      api['submodule:status'](path)
    ]);
    submodules.value = list;
    status.value = states;
  }
  finally
  {
    loading.value = false;
  }
}

/** The absolute path a submodule sits at: what opening one as a repository needs. */
function absolutePath(entry: SubmoduleEntry): string
{
  const root = repo.repo?.path ?? '';
  return `${root}/${entry.path}`.replace(/\/+/g, '/');
}

async function add(): Promise<void>
{
  if (!(await run(addArgv.value, ['submodules', 'worktree', 'index'], { close: false })))
  {
    return;
  }
  newUrl.value = '';
  newPath.value = '';
  newBranch.value = '';
  await load();
}

async function update(): Promise<void>
{
  if (updateArgv.value.length && (await run(updateArgv.value, ['submodules', 'worktree'], { close: false })))
  {
    await load();
  }
}

async function sync(): Promise<void>
{
  const path = current.value?.path;
  // `submodule sync` rewrites the recorded URLs and nothing else.
  if (await run(syncArgv.value, ['submodules', 'config'], { close: false }))
  {
    let message: string;
    if (path)
    {
      message = `Synchronized ${path}`;
    }
    else
    {
      message = 'Synchronized every submodule';
    }
    ui.toast(message);
  }
}

async function remove(): Promise<void>
{
  const entry = current.value;
  if (!entry)
  {
    return;
  }

  const ok = await ui.confirm({
    title: `Remove ${entry.path}?`,
    message:
      'Empties the working tree and drops the entry. Its clone stays under `.git/modules`.',
    confirmLabel: 'Remove it',
    danger: true
  });
  if (!ok)
  {
    return;
  }

  if (await runSteps(removeSteps.value, ['submodules', 'worktree', 'index'], { close: false }))
  {
    select(null);
    await load();
  }
}

/** Open it as a repository: in this window, or in one of its own. */
async function open(entry: SubmoduleEntry, newWindow: boolean): Promise<void>
{
  const path = absolutePath(entry);
  await perform(
    'Opening the submodule',
    async () =>
    {
      if (newWindow)
      {
        return api['repo:openWindow'](path);
      }
      else
      {
        return api['repo:openHere'](path);
      }
    },
    { refresh: false, close: !newWindow }
  );
}

onMounted(load);
</script>

<template>
  <DialogFrame title="Submodules" fixed-height @close="emit('close')">
    <div class="split">
      <ul class="list side">
        <!-- The pseudo-entry, as in the stash dialog: acting on every submodule at once is
             a row you select, so the preview below describes it like any other. -->
        <li>
          <button class="entry" :class="{ current: isAll }" @click="select(null)">
            <span class="title">All submodules</span>
            <span class="detail">{{ submodules.length }} declared</span>
          </button>
        </li>
        <li v-for="entry in submodules" :key="entry.path">
          <button
            class="entry"
            :class="{ current: !adding && selected === entry.path }"
            @click="select(entry.path)"
          >
            <span class="title path truncate" :title="entry.path">{{ entry.path }}</span>
            <span class="detail truncate">{{ describe(entry) }}</span>
          </button>
        </li>
        <li>
          <button class="entry" :class="{ current: isAdding }" @click="adding = true">
            <span class="title">Add a submodule…</span>
          </button>
        </li>
      </ul>

      <div class="detail-pane">
        <p v-if="loading" class="placeholder">Reading…</p>

        <!-- Adding one: the same three fields a submodule has. -->
        <div v-else-if="isAdding" class="form">
          <FormText
            v-model="newUrl"
            label="Clone from"
            placeholder="https://example.com/library.git"
          />
          <FormText
            v-model="newPath"
            label="Into"
            placeholder="vendor/library"
            hint="Relative to this repository; goes into `.gitmodules`."
          />
          <FormText
            v-model="newBranch"
            label="Track branch"
            placeholder="Optional: a fixed commit otherwise"
            hint="`-b`: otherwise it is pinned to one commit."
          />
          <FormCheck
            v-model="force"
            label="Add it even where git would refuse"
            hint="`-f`: an ignored path, or one that already exists."
          />

          <CommandPreview :argv="addArgv" placeholder="Enter a URL and a path" />
          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <template v-else-if="current">
          <div class="form">
            <FormText
              :model-value="current.url"
              label="Clone from"
              readonly
              hint="From `.gitmodules`: a change upstream needs a sync."
            />
            <FormText
              :model-value="currentStatus?.sha ?? ''"
              label="At commit"
              readonly
              :hint="currentStatus?.described || undefined"
            />
            <FormText
              :model-value="current.branch ?? 'a fixed commit'"
              label="Tracks"
              readonly
            />

            <DangerNote v-if="currentStatus?.state === SUBMODULE_STATE_CONFLICTED">
              Conflicts inside it. Open it and resolve them there.
            </DangerNote>

            <FormCheck
              v-model="fromRemote"
              label="Take the branch's latest commit"
              :disabled="!current.branch"
              :hint="
                current.branch
                  ? `\`--remote\`: updates to the head of \`${current.branch}\` rather than the commit this repository records.`
                  : 'Only for a submodule that tracks a branch.'
              "
            />

            <CommandPreview :argv="updateArgv" />
            <p v-if="error" class="error">{{ error }}</p>
          </div>

          <div class="actions">
            <button :disabled="busy" @click="open(current, false)">Open</button>
            <button :disabled="busy" @click="open(current, true)">Open in New Window</button>
            <button class="del" :disabled="busy" @click="remove">Remove</button>
          </div>
        </template>

        <!-- The "all" row. Both of the whole-repository commands land here. -->
        <div v-else class="form">
          <p v-if="!submodules.length" class="placeholder">
            This repository has no submodules.
          </p>
          <p v-else class="hint">
            Update checks out the recorded commit. Synchronize copies URLs into
            <code>.git/config</code>.
          </p>

          <CommandPreview :argv="updateArgv" />
          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
      <button v-if="!isAdding" :disabled="busy || !submodules.length" @click="sync">
        {{ current ? 'Synchronize' : 'Synchronize All' }}
      </button>
      <template v-if="isAdding">
        <button class="primary" :disabled="!addArgv.length || busy" @click="add">
          {{ busy ? 'Adding…' : 'Add Submodule' }}
        </button>
      </template>
      <template v-else>
        <button
          class="primary"
          :disabled="!updateArgv.length || busy || !submodules.length"
          @click="update"
        >
          {{ busy ? 'Updating…' : isAll ? 'Update All' : 'Update' }}
        </button>
      </template>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>
<style scoped>

/* The list picks the operand and the pane acts on it: the remotes dialog's division. */
.side {
  flex: none;
  width: 240px;
}

.title {
  font-size: var(--text-sm);
  max-width: 100%;
}

/* Monospace belongs to the paths, not to the two rows that are sentences. */
.title.path {
  font-family: var(--font-mono);
}

.detail {
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  max-width: 100%;
}
</style>
