<script setup lang="ts">
/**
 * Git executable and terminal app. Manual refs saved on `change` (Enter or blur),
 * not choice() bindings: a half-typed path should not be saved. Refs follow updates
 * from elsewhere (e.g. Reset to Defaults).
 */

import { ref, watch } from 'vue';
import FormText from '@renderer/components/ui/FormText.vue';
import { useSettingsStore } from '@renderer/stores/settings.js';

const store = useSettingsStore();
const gitPath = ref(store.settings.gitPath ?? '');
const terminalApp = ref(store.settings.terminalApp ?? '');

watch(
  () => store.settings.gitPath,
  (value) => (gitPath.value = value ?? '')
);
watch(
  () => store.settings.terminalApp,
  (value) => (terminalApp.value = value ?? '')
);

function saveGitPath(): void
{
  void store.patch({ gitPath: gitPath.value.trim() || null });
}

function saveTerminalApp(): void
{
  void store.patch({ terminalApp: terminalApp.value.trim() || null });
}
</script>

<template>
  <div class="form">
    <FormText
      v-model="gitPath"
      label="Executable"
      placeholder="Auto-detect"
      hint="Leave empty to find `git` on your PATH."
      @change="saveGitPath"
    />
    <FormText
      v-model="terminalApp"
      label="Terminal"
      :monospace="false"
      placeholder="iTerm2, or Terminal"
      hint="Empty: iTerm2 if installed, else Terminal."
      @change="saveTerminalApp"
    />
  </div>
</template>
