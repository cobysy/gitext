<script setup lang="ts">
/**
 * Make a repository, then open it.
 *
 * The other of the two dialogs that create rather than act, and the simpler one: no
 * remote, so no console window, and the whole form is a folder and a name. It runs in the
 * chosen folder, and `git init <name>` makes the directory inside it.
 *
 * The initial branch is deliberately empty by default. Git takes it from
 * `init.defaultBranch`, and filling this in with `main` would quietly override whatever
 * the machine is set to, on every repository made here.
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildInitArgs } from '@renderer/model/args/create.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const emit = defineEmits<{ close: [] }>();

const { busy, error, run } = useDialog();

const folder = ref('');
const name = ref('');
const initialBranch = ref('');

const trimmedName = computed(() => name.value.trim());

/** Where it lands: the chosen folder with the new repository's directory inside it. */
const destination = computed(() =>
{
  if (!folder.value || !trimmedName.value)
  {
    return '';
  }
  return `${folder.value.replace(/\/+$/, '')}/${trimmedName.value}`;
});

const argv = computed(() =>
{
  if (!destination.value)
  {
    return [];
  }
  return buildInitArgs({
    directory: destination.value,
    initialBranch: initialBranch.value.trim()
  });
});

async function browse(): Promise<void>
{
  const picked = await api['file:chooseDirectory'](folder.value);
  if (picked)
  {
    folder.value = picked;
  }
}

async function create(): Promise<void>
{
  if (!argv.value.length || busy.value)
  {
    return;
  }
  const target = destination.value;

  // Same shape as Clone: run in the folder that exists, invalidate nothing, and open what
  // was made instead of refreshing what is not there.
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
  <DialogFrame title="New Repository" @close="emit('close')">
    <div class="form">
      <FormText
        v-model="folder"
        label="Create in"
        placeholder="Choose a folder"
        hint="The folder to put it in, not the repository's own directory."
      >
        <template #addon>
          <button @click="browse">Browse…</button>
        </template>
      </FormText>
      <FormText v-model="name" label="Repository name" placeholder="my-project" />
      <FormText
        v-model="initialBranch"
        label="First branch"
        placeholder="From your git config"
        hint="`--initial-branch`: left empty, git uses `init.defaultBranch`"
      />

      <CommandPreview :argv="argv" placeholder="Choose a folder and a name" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="create">
        {{ busy ? 'Creating…' : 'Create' }}
      </button>
    </template>
  </DialogFrame>
</template>
