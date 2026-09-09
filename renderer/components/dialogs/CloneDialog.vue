<script setup lang="ts">
/**
 * Clone a repository, then open it.
 *
 * One of the two dialogs that make a repository rather than acting on one, which is what
 * every unusual thing about it comes from. It opens with none open, so it runs in the
 * folder the clone lands in (`cwd`) rather than in the window's repository, and it asks
 * for nothing to be refreshed afterwards: there is nothing yet to reload.
 *
 * It always talks to a remote, so `gitConsole` gives it a console window without being
 * asked: `clone` is in `NETWORK_VERBS`. Watching it is the point, since this is the one
 * command in the app that can run for minutes.
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildCloneArgs } from '@renderer/model/args/create.js';
import { flagsIn } from '@renderer/model/args/summary.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import FormNumber from '@renderer/components/ui/FormNumber.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const emit = defineEmits<{ close: [] }>();

const { busy, error, run } = useDialog();

const url = ref('');
const folder = ref('');
const showOptions = ref(false);
const depth = ref(0);
const branch = ref('');
const recurseSubmodules = ref(false);

/**
 * The last path segment of the URL without `.git`, which is what git itself would name
 * the directory. A suggestion the field shows rather than a value it holds: overwriting
 * what someone typed because they went back and fixed the URL would be worse than not
 * guessing at all.
 */
const suggestedName = computed(() =>
{
  const trimmed = url.value.trim().replace(/\/+$/, '');
  if (!trimmed)
  {
    return '';
  }
  const last = trimmed.split(/[/:]/).pop() ?? '';
  return last.replace(/\.git$/, '');
});

const name = ref('');
const effectiveName = computed(() => name.value.trim() || suggestedName.value);

/** Where it lands: the chosen folder with the repository's own directory inside it. */
const destination = computed(() =>
{
  if (!folder.value || !effectiveName.value)
  {
    return '';
  }
  return `${folder.value.replace(/\/+$/, '')}/${effectiveName.value}`;
});

const argv = computed(() =>
{
  if (!url.value.trim() || !destination.value)
  {
    return [];
  }
  return buildCloneArgs({
    url: url.value.trim(),
    destination: destination.value,
    depth: depth.value,
    branch: branch.value.trim(),
    recurseSubmodules: recurseSubmodules.value
  });
});

const optionsSummary = computed(() => flagsIn(argv.value));

async function browse(): Promise<void>
{
  const picked = await api['file:chooseDirectory'](folder.value);
  if (picked)
  {
    folder.value = picked;
  }
}

async function clone(): Promise<void>
{
  if (!argv.value.length || busy.value)
  {
    return;
  }
  const target = destination.value;

  // Runs in the folder the clone lands in, which exists; the clone makes the directory
  // inside it. Nothing to invalidate and nothing to refresh: there is no repository open
  // yet, and opening the new one below is what takes the place of a refresh. `close:
  // false` because the window has to outlive the run long enough to open what it made.
  const ok = await run(argv.value, [], {
    cwd: folder.value,
    refresh: false,
    close: false
  });

  if (ok)
  {
    // Opened in the window behind this one, never here: a dialog is its own renderer
    // process with a store of its own, so `repo.open` would load the repository into the
    // window that is about to close and leave the repository window on the welcome
    // screen. `repo:openHere` is the same route the worktree and submodule dialogs take.
    await api['repo:openHere'](target);
    emit('close');
  }
}
</script>

<template>
  <DialogFrame title="Clone Repository" @close="emit('close')">
    <div class="form">
      <FormText v-model="url" label="Repository URL" placeholder="git@github.com:owner/name.git" />
      <FormText
        v-model="folder"
        label="Clone into"
        placeholder="Choose a folder"
        hint="The folder to put it in, not the repository's own directory."
      >
        <template #addon>
          <button @click="browse">Browse…</button>
        </template>
      </FormText>
      <FormText
        v-model="name"
        label="Directory name"
        :placeholder="suggestedName || 'Taken from the URL'"
      />

      <FormDisclosure v-model="showOptions" :summary="optionsSummary">
        <FormNumber v-model="depth" label="Depth" :min="0" hint="`--depth`: 0 clones all history" />
        <FormText v-model="branch" label="Branch" hint="`--branch`: the remote's default otherwise" />
        <FormCheck v-model="recurseSubmodules" label="Clone submodules too" hint="`--recurse-submodules`" />
      </FormDisclosure>

      <CommandPreview :argv="argv" placeholder="Enter a URL and a folder" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="clone">
        {{ busy ? 'Cloning…' : 'Clone' }}
      </button>
    </template>
  </DialogFrame>
</template>
