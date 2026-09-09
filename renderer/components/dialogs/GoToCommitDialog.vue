<script setup lang="ts">
/**
 * Go to Commit. **Not an operation dialog**: nothing here runs a git command, so it
 * resolves a revision and moves the *repository window's* selection over
 * `dialog:goToRevision`, using `useDialog`'s `perform(..., { refresh: false })` for the
 * busy/error/close bookkeeping around work that isn't `git:run`. **The dialog is the
 * picker**: one filter box (`RevisionPicker`) over the refs, that also accepts anything
 * git can resolve, rather than three separate controls needing a focus-based rule. The
 * box opens holding whatever text was on the clipboard, once git confirms it resolves.
 */

import { onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';
import type { RevisionChoice } from '@renderer/model/revisionChoices.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import RevisionPicker from '@renderer/components/dialogs/parts/RevisionPicker.vue';

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const { busy, error, perform } = useDialog();

/** The row the keyboard is on: what the Go button acts upon. */
const active = ref<RevisionChoice | null>(null);

/** What the box opens holding, once the clipboard has been checked. The picker mounts with it, not written afterwards, to avoid fighting the watcher that resolves what's typed. */
const seed = ref<string | null>(null);

/** Held until the clipboard has been checked, so the picker mounts exactly once, with the seed already in it or not at all. */
const ready = ref(false);

/** True when `text` is a plausible-looking revision that git actually knows. */
async function isKnownRevision(path: string | undefined, text: string, plausible: boolean): Promise<boolean>
{
  return !!path && plausible && !!(await api['revisions:describe'](path, text));
}

onMounted(async () =>
{
  const path = repo.repo?.path;
  let text = '';
  try
  {
    text = (await api['clipboard:read']()).trim();
  }
  catch
  {
    // A clipboard that can't be read isn't a reason to fail to open: the box simply starts empty, as it would have anyway.
  }
  // One line, short enough to be a revision rather than a paragraph. Checked before git is asked, so a copied file is not a subprocess.
  const plausible = text.length > 0 && text.length <= 200 && !/\s/.test(text);
  if (await isKnownRevision(path, text, plausible))
  {
    seed.value = text;
  }
  ready.value = true;
});

/**
 * Hand the commit to the window that has a grid. Closing on success is `useDialog`'s
 * doing; whether the commit is *on screen* is that window's question, answered with a
 * toast, the same one clicking a branch in the left panel gives.
 */
async function go(choice: RevisionChoice | null = active.value): Promise<void>
{
  const sha = choice?.sha;
  if (!sha)
  {
    return;
  }
  await perform('Going to the commit', async () => api['dialog:goToRevision'](sha), {
    refresh: false
  });
}
</script>

<template>
  <!-- `fixed-height`: the list is rebuilt on every keystroke, and a window that followed it would resize under the hands of the person typing. -->
  <DialogFrame title="Go to Commit" fixed-height @close="emit('close')">
    <div class="form">
      <RevisionPicker
        v-if="ready"
        v-model="active"
        :initial-query="seed ?? ''"
        placeholder="A SHA, a branch, a tag, or HEAD~3…"
        autofocus
        @choose="go"
      />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!active?.sha || busy" @click="go()">
        {{ busy ? 'Going…' : 'Go' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
/**
 * The picker fills the window rather than sitting at its natural height: a list that
 * stops halfway down a window it was given the whole of reads as a rendering fault.
 */
.form {
  height: 100%;
  min-height: 0;
}

.form :deep(.picker-body) {
  height: 100%;
}

.form :deep(.rows) {
  max-height: none;
}
</style>
