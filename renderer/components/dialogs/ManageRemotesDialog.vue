<script setup lang="ts">
/**
 * The remotes: `remote.<name>.pushurl` is what a fork is (fetch upstream over https,
 * push your own over ssh, one remote), so this dialog edits both fetch and push URLs, not just one.
 *
 * The shape is the stash dialog's: a list you select in, a pane that acts on the
 * selection, a window you keep working in. Every action passes `{ close: false }` and reloads the list.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import {
  buildRemoteAddArgs,
  buildRemotePruneArgs,
  buildRemoteRemoveArgs,
  buildRemoteSaveSteps,
  draftFromRemote,
  type RemoteDraft
} from '@renderer/model/args/remote.js';
import type { RemoteEntry } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useUiStore } from '@renderer/stores/ui.js';
import CodeText from '@renderer/components/ui/CodeText.vue';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, perform, run, runSteps, close } = useDialog();

const remotes = ref<RemoteEntry[]>([]);
const loading = ref(true);
/** The remote being edited, or null before the list has loaded. */
const selected = ref<string | null>(null);
/**
 * The "add a remote" row, which is a mode rather than a selection: with `selected ===
 * null` instead, the window would open on an empty form with every remote unselected.
 */
const adding = ref(false);

const blank: RemoteDraft = { name: '', fetchUrl: '', pushUrl: '' };
/** The row as it is stored, and the row as it is being edited. */
const original = ref<RemoteDraft>({ ...blank });
const draft = ref<RemoteDraft>({ ...blank });

/**
 * Active and inactive, as two groups: a deactivated remote listed indistinguishably
 * from a live one is the worst of both, since git can't see its section at all.
 */
const groups = computed(() => [
  { label: 'Active', entries: remotes.value.filter((entry) => !entry.disabled) },
  { label: 'Inactive', entries: remotes.value.filter((entry) => entry.disabled) }
]);

const isNew = computed(() => adding.value);

const selectedEntry = computed(() =>
{
  let found: RemoteEntry | undefined;
  if (adding.value)
  {
    found = undefined;
  }
  else
  {
    found = remotes.value.find((entry) => entry.name === selected.value);
  }
  return found ?? null;
});

/**
 * A deactivated remote is not a remote as far as git is concerned: its section is
 * spelled `-remote.<name>`, so rename/set-url/prune/remove all fail with "No such remote".
 */
const isInactive = computed(() => selectedEntry.value?.disabled ?? false);
const editable = computed(() => isNew.value || (!!selectedEntry.value && !isInactive.value));

function select(name: string | null): void
{
  adding.value = name === null;
  if (name !== null)
  {
    selected.value = name;
  }
}

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
    remotes.value = await api['remote:list'](path);
    // Open on a remote, not the add form: this window is the list, and the form is
    // what you do to whichever row is chosen. Prefer an active one, or the window opens read-only.
    if (!remotes.value.some((entry) => entry.name === selected.value))
    {
      const first = remotes.value.find((entry) => !entry.disabled) ?? remotes.value[0];
      selected.value = first?.name ?? null;
    }
    // Nothing to select, so the only thing this window can do is add one.
    if (!remotes.value.length)
    {
      adding.value = true;
    }
  }
  catch (err)
  {
    error.value = toMessage(err);
  }
  finally
  {
    loading.value = false;
  }
}

/** Fill the form from whichever row is selected: the payload rule, inside one window. */
watch([selectedEntry, adding], () =>
{
  const entry = selectedEntry.value;
  if (entry)
  {
    original.value = draftFromRemote(entry);
  }
  else
  {
    original.value = { ...blank };
  }
  draft.value = { ...original.value };
});

/**
 * The name is taken, including by an *inactive* remote, the case worth catching:
 * `remote add origin` succeeds while `-remote.origin.*` sits in config, colliding only
 * later when the inactive one reactivates.
 */
const clash = computed(() =>
{
  const name = draft.value.name.trim();
  if (!name || name === original.value.name)
  {
    return '';
  }
  const taken = remotes.value.find((entry) => entry.name === name);
  if (!taken)
  {
    return '';
  }
  if (taken.disabled)
  {
    return `An inactive remote named \`${name}\` already exists: activate it instead.`;
  }
  else
  {
    return `A remote named \`${name}\` already exists.`;
  }
});

/**
 * What Save would run: one command for a new remote, and for an existing one everything
 * that turns the stored row into the edited one: in an order the rename cannot break.
 */
const steps = computed(() =>
{
  // An inactive remote has nothing to run against it, whatever is in the fields.
  if (!editable.value)
  {
    return [];
  }
  if (!isNew.value)
  {
    return buildRemoteSaveSteps(original.value, draft.value);
  }
  const added = [
    {
      label: `Adding ${draft.value.name.trim() || 'the remote'}`,
      argv: buildRemoteAddArgs(draft.value.name, draft.value.fetchUrl)
    }
  ];
  // A push URL on a new remote is a second command: `git remote add` has no flag for one.
  if (draft.value.pushUrl.trim())
  {
    added.push(
      ...buildRemoteSaveSteps(
        { ...draft.value, pushUrl: '' },
        { ...draft.value, name: draft.value.name.trim() }
      )
    );
  }
  return added.filter((step) => step.argv.length > 0);
});

const canSave = computed(() => steps.value.length > 0 && !clash.value);

/** What the preview strip says when there is no command, which is a different fact per mode. */
const nothingToRun = computed(() =>
{
  if (isInactive.value)
  {
    return 'Activate the remote before git can act on it';
  }
  if (isNew.value)
  {
    return 'Enter a name and a URL';
  }
  else
  {
    return 'Nothing has changed';
  }
});

async function save(): Promise<void>
{
  if (!canSave.value)
  {
    return;
  }
  const name = draft.value.name.trim();
  if (!(await runSteps(steps.value, ['remotes', 'refs', 'config'], { close: false })))
  {
    return;
  }
  selected.value = name;
  adding.value = false;
  await load();
}

async function remove(): Promise<void>
{
  const name = selectedEntry.value?.name;
  if (!name)
  {
    return;
  }
  const ok = await ui.confirm({
    title: `Remove ${name}?`,
    message:
      'The remote and its tracking branches go. The server is untouched.',
    confirmLabel: 'Remove it',
    danger: true
  });
  if (!ok)
  {
    return;
  }
  if (!(await run(buildRemoteRemoveArgs(name), ['remotes', 'refs', 'config'], { close: false })))
  {
    return;
  }
  if (selected.value === name)
  {
    selected.value = null;
  }
  adding.value = false;
  await load();
}

/**
 * Switch the selected remote off, or back on. `perform`, not `run`: not a git
 * operation, a config section renamed out of git's sight, going through its own channel.
 */
async function toggleActive(): Promise<void>
{
  const entry = selectedEntry.value;
  if (!entry)
  {
    return;
  }
  const activating = entry.disabled;
  let verb: string;
  if (activating)
  {
    verb = 'Activating';
  }
  else
  {
    verb = 'Deactivating';
  }
  const ok = await perform(
    `${verb} ${entry.name}`,
    (path) => api['remote:setEnabled'](path, entry.name, activating),
    { close: false }
  );
  if (ok)
  {
    await load();
  }
}

/** Delete the tracking refs for branches that no longer exist on the remote. */
async function prune(): Promise<void>
{
  const name = selectedEntry.value?.name;
  if (!name)
  {
    return;
  }
  if (await run(buildRemotePruneArgs(name), REFS, { close: false }))
  {
    ui.toast(`Pruned the stale tracking refs for \`${name}\``);
  }
}

onMounted(load);
</script>

<template>
  <DialogFrame title="Manage Remotes" fixed-height @close="emit('close')">
    <div class="split">
      <ul class="list side">
        <li v-if="loading" class="placeholder">Reading…</li>
        <template v-for="group in groups" :key="group.label">
          <!-- A heading only over a group that has rows: "Inactive" over nothing says a
               repository has inactive remotes when it has none. -->
          <template v-if="group.entries.length">
            <li class="group">{{ group.label }}</li>
            <li v-for="entry in group.entries" :key="entry.name">
              <button
                class="entry"
                :class="{ current: selectedEntry?.name === entry.name, off: entry.disabled }"
                @click="select(entry.name)"
              >
                <span class="title name truncate">{{ entry.name }}</span>
                <span class="detail truncate" :title="entry.fetchUrl">{{ entry.fetchUrl }}</span>
                <!-- Only when it differs: saying "pushes to the same place" on every row
                     would make the row that genuinely differs invisible. -->
                <span
                  v-if="entry.pushUrl !== entry.fetchUrl"
                  class="detail truncate"
                  :title="entry.pushUrl"
                >
                  pushes to {{ entry.pushUrl }}
                </span>
              </button>
            </li>
          </template>
        </template>
        <!-- Last row, and set apart from the groups above it: it is the one row in the box
             that is not a remote, and under an "Inactive" heading it would read as one. -->
        <li class="add">
          <button class="entry" :class="{ current: isNew }" @click="select(null)">
            <span class="title">Add a remote…</span>
          </button>
        </li>
      </ul>

      <div class="detail-pane">
        <div class="form">
          <FormText
            v-model="draft.name"
            label="Name"
            placeholder="origin"
            :disabled="!editable"
            :hint="
              isInactive
                ? 'Deactivated: git ignores it until you activate it.'
                : 'Renaming one moves its tracking branches with it.'
            "
          />
          <FormText
            v-model="draft.fetchUrl"
            label="Fetch from"
            placeholder="https://example.com/project.git"
            :disabled="!editable"
          />
          <FormText
            v-model="draft.pushUrl"
            label="Push to"
            placeholder="The same place"
            :disabled="!editable"
            hint="`remote.<name>.pushurl`: empty pushes where you fetch."
          />

          <CommandPreview :steps="steps" :placeholder="nothingToRun" />
          <p v-if="clash" class="error"><CodeText :text="clash" /></p>
          <p v-else-if="error" class="error">{{ error }}</p>
        </div>

        <!-- Always rendered, disabled where it does not apply. Behind a `v-if` on the
             selection, choosing "Add a remote…" takes a row of buttons out of the pane and
             the window resizes itself around the gap. -->
        <div class="actions">
          <button :disabled="busy || !selectedEntry" @click="toggleActive">
            {{ isInactive ? 'Activate' : 'Deactivate' }}
          </button>
          <button :disabled="busy || !editable || isNew" @click="prune">
            Prune stale branches
          </button>
          <button class="del" :disabled="busy || !editable || isNew" @click="remove">
            Remove
          </button>
        </div>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
      <button class="primary" :disabled="!canSave || busy" @click="save">
        {{ busy ? 'Saving…' : isNew ? 'Add Remote' : 'Save Changes' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>
<style scoped>

/* The list picks the operand, keeping a fixed share while the pane takes the rest,
   the same division as the stash dialog. Capped, so a dozen remotes don't decide the window's height. */
.side {
  flex: none;
  width: 220px;
  max-height: 380px;
}

/* "Active" / "Inactive" over the rows they head: a caption, not a row you can click. */
.group {
  padding: var(--space-1) var(--space-2);
  background: var(--bg);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Grey: the row is still readable, but nothing about it is live, git will not fetch it
   and none of the buttons opposite will run. */
.entry.off .title {
  color: var(--fg-muted);
}

/* A full-strength rule under the last group, so the add row belongs to the box rather
   than to the group it happens to sit beneath. */
.list.side > li.add {
  border-top-color: var(--border);
}

/* A fetch/push URL is read character by character; the shared `.entry .detail` rule
   stays proportional for the stash dialog, so this adds mono on top. */
.entry .detail {
  font-family: var(--font-mono);
}

/* Same reason: `origin` in the prose face is a word. The modifier, not `.title`, since
   the last row is "Add a remote…", a sentence. */
.entry .title.name {
  font-family: var(--font-mono);
}
</style>
