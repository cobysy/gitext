<script setup lang="ts">
/**
 * Edit a git file (gitignore/gitattributes/exclude/config) or a working file.
 * Config files are checked before saving (git won't run against invalid config).
 */

import { computed, ref, watch } from 'vue';
import type { RepoTextFile } from '@shared/types.js';
import { api } from '@renderer/api.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';

const props = withDefaults(
  defineProps<{
    target?: RepoTextFile;
    /** A working file to edit instead, repo-relative. Takes precedence over `target`. */
    filePath?: string;
  }>(),
  { target: 'gitignore', filePath: undefined }
);

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const ui = useUiStore();
const { busy, error, perform } = useDialog();

/** What is in the box. */
const text = ref('');
/** What was read, so "has this been edited" is a comparison rather than a flag. */
const original = ref('');
const loading = ref(true);
/** Git's complaint about the config being saved, shown instead of writing it. */
const invalid = ref('');

const DESCRIPTIONS: Record<RepoTextFile, { name: string; hint: string }> = {
  gitignore: {
    name: '.gitignore',
    hint: 'Committed, applies to everyone who clones.'
  },
  exclude: {
    name: '.git/info/exclude',
    hint: 'Never committed. These rules are yours alone.'
  },
  gitattributes: {
    name: '.gitattributes',
    hint: 'Per-path settings: line endings, diff, merge.'
  },
  config: {
    name: '.git/config',
    hint: 'This repository’s config. Checked before saving.'
  }
};

/**
 * What is being edited. Working files have no hint (their name is self-explanatory).
 */
const file = computed(() =>
{
  if (props.filePath)
  {
    return { name: props.filePath, hint: '' };
  }
  return DESCRIPTIONS[props.target];
});
const dirty = computed(() => text.value !== original.value);

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
    let contents: string;
    if (props.filePath)
    {
      contents = await api['file:readWorkingText'](path, props.filePath);
    }
    else
    {
      contents = await api['file:readRepoText'](path, props.target);
    }
    text.value = contents;
    original.value = contents;
  }
  finally
  {
    loading.value = false;
  }
}

watch(() => [repo.repo?.path, props.target, props.filePath] as const, load, { immediate: true });

async function save(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }

  const editing = props.filePath;
  if (editing)
  {
    // Working files have no syntax to check. Invalidation is declared on the IPC channel.
    await perform(`Saving ${editing}`, (repoPath) =>
      api['file:writeWorkingText'](repoPath, editing, text.value)
    );
    return;
  }

  // Checked here rather than inside the write so the message can be shown with the text
  // still in the box: a save that fails must leave you looking at what you typed.
  invalid.value = (await api['file:checkRepoText'](path, props.target, text.value)) ?? '';
  if (invalid.value)
  {
    return;
  }

  await perform(`Saving ${file.value.name}`, async (repoPath) =>
  {
    await api['file:writeRepoText'](repoPath, props.target, text.value);
  });
}

/**
 * Confirm before closing an edited file (not suppressible: text box edits have no reflog).
 */
async function requestClose(): Promise<void>
{
  if (!dirty.value)
  {
    emit('close');
    return;
  }
  const confirmed = await ui.confirm({
    title: `Discard changes to ${file.value.name}?`,
    message: 'The file has been edited but not saved. Closing loses the edit.',
    confirmLabel: 'Discard',
    danger: true
  });
  if (confirmed)
  {
    emit('close');
  }
}
</script>

<template>
  <DialogFrame :title="`Edit ${file.name}`" fixed-height @close="requestClose">
    <div class="form fills">
      <p v-if="file.hint" class="hint">{{ file.hint }}</p>

      <!-- `editor` is what the styles below stretch: without the class the box stayed at
           its four rows in a window sized for a file, leaving most of it blank. -->
      <FormTextArea
        v-model="text"
        class="editor"
        :rows="4"
        monospace
        :disabled="loading"
        :placeholder="loading ? 'Reading…' : 'This file is empty. Saving will create it.'"
      />

      <p v-if="invalid" class="error">{{ invalid }}</p>
      <p v-else-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="requestClose">Cancel</button>
      <button class="primary" :disabled="!dirty || busy || loading" @click="save">
        {{ busy ? 'Saving…' : 'Save' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
/*
 * A `fixedHeight` window gives the body its room; the children still have to take it.
 *
 * `class="editor"` lands on `FormRow`'s own root, which is the `<label>`, so the old
 * `.editor :deep(label)` was looking for a label inside a label and matched nothing: the
 * box stayed at its four rows with most of the window blank under it. Three steps, each
 * needed: the row grows, the control inside it grows, and the textarea fills the control.
 */
.editor {
  flex: 1;
  min-height: 0;
}

.editor :deep(.control) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.editor :deep(textarea) {
  flex: 1;
  min-height: 0;
  /* The box is the window; dragging its corner would fight the window's own edge. */
  resize: none;
}
</style>
