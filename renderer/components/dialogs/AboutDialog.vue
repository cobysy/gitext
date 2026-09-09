<script setup lang="ts">
/** About dialog with git environment info. */

import { onMounted, ref } from 'vue';
import { copyText } from '@renderer/clipboard.js';
import type { GitEnvironment } from '@shared/types.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { api } from '@renderer/api.js';

const emit = defineEmits<{ close: [] }>();
const env = ref<GitEnvironment | null>(null);
const appInfo = ref<{ name: string; version: string; electron: string } | null>(null);
const copied = ref(false);

onMounted(async () =>
{
  env.value = await api['env:git']();
  appInfo.value = await api['env:app']();
});

async function copyDiagnostics(): Promise<void>
{
  // What a bug report needs, in the order someone reading one wants it. The raw
  // `navigator.userAgent` used to stand in for the platform line: a Chromium version
  // string that says nothing about this app and buries the part that matters.
  const lines = [
    `gitext ${appInfo.value?.version ?? '-'}`,
    `Electron: ${appInfo.value?.electron ?? '-'}`,
    `Git: ${env.value?.version?.raw ?? 'not found'}`,
    `Git path: ${env.value?.path ?? '-'}`
  ];
  if (!(await copyText(lines.join('\n'), null)))
  {
    return;
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <DialogFrame title="About gitext" @close="emit('close')">
    <p class="lead">A Git GUI where every action runs the git CLI.</p>

    <dl>
      <dt>Version</dt>
      <dd class="selectable">{{ appInfo?.version ?? '…' }}</dd>
      <dt>Git</dt>
      <dd class="selectable">{{ env?.version?.raw ?? env?.error ?? 'Detecting…' }}</dd>
      <dt>Git path</dt>
      <dd class="selectable">{{ env?.path ?? 'Not found' }}</dd>
    </dl>

    <template #actions>
      <button @click="copyDiagnostics">{{ copied ? 'Copied' : 'Copy diagnostics' }}</button>
      <button class="primary" @click="emit('close')">Close</button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/factList.css"></style>
<style scoped>
.lead {
  margin: 0 0 var(--space-3);
  color: var(--fg-muted);
}

</style>
