<script setup lang="ts">
/**
 * Shown when no repository is open: first run, or the last one is gone.
 *
 * The three ways a repository comes to be open, and the list of the ones that were. They
 * are registry commands run through `runCommand`, not calls into the store, because the
 * File menu offers the same three and two surfaces must not drift about what they do.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

const COMMAND_OPEN = 'repo.open';
const COMMAND_CLONE = 'repo.clone';
const COMMAND_INIT = 'repo.init';

const repoStore = useRepoStore();
const settingsStore = useSettingsStore();
const context = useCommandContext();

const recents = computed(() => settingsStore.settings.recentRepos);

function basename(path: string): string
{
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Entries removed in this session, so the list updates without a settings round trip. */
const forgotten = ref<string[]>([]);

/** A failed open is worth reading once, not for the rest of the session. */
const errorDismissed = ref(false);

const recentsShown = computed(() =>
  recents.value.filter((path) => !forgotten.value.includes(path)));

watch(() => repoStore.error, () => (errorDismissed.value = false));

function onDrop(event: DragEvent): void
{
  const file = event.dataTransfer?.files?.[0];
  if (!file)
  {
    return;
  }
  // Electron 32 removed `File.path`; `webUtils` behind the preload bridge is what is
  // left, and it is the only reason this drop target does anything at all.
  const path = api.pathForFile(file);
  if (path)
  {
    void repoStore.open(path);
  }
}

/** Take a repository off the list without opening it. */
async function forget(path: string): Promise<void>
{
  forgotten.value = [...forgotten.value, path];
  await api['repo:forgetRecent'](path);
}
</script>

<template>
  <div class="welcome" @dragover.prevent @drop.prevent="onDrop">
    <div class="panel">
      <h1>gitext</h1>
      <p class="tagline">Open, clone or make a repository, or drop a folder here.</p>

      <div class="actions">
        <button class="primary" @click="runCommand(COMMAND_OPEN, context)">Open Repository…</button>
        <button @click="runCommand(COMMAND_CLONE, context)">Clone…</button>
        <button @click="runCommand(COMMAND_INIT, context)">New Repository…</button>
      </div>

      <!-- Dismissible: a failed open otherwise sits under the buttons for the rest of the
           session, naming a path the user has already moved on from. -->
      <p v-if="repoStore.error && !errorDismissed" class="error open-error">
        <span class="truncate" :title="repoStore.error">{{ repoStore.error }}</span>
        <button class="dismiss" aria-label="Dismiss" title="Dismiss" @click="errorDismissed = true">✕</button>
      </p>

      <section v-if="recentsShown.length" class="recents">
        <h2>Recent</h2>
        <ul>
          <li v-for="path in recentsShown" :key="path">
            <button class="recent" :title="path" @click="repoStore.open(path)">
              <span class="name">{{ basename(path) }}</span>
              <span class="path truncate">{{ path }}</span>
            </button>
            <button class="forget" :title="`Remove ${basename(path)} from this list`"
                    :aria-label="`Remove ${basename(path)} from this list`"
                    @click="forget(path)">✕</button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* The row holding a recent repository and the button that forgets it. */
.recents li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.recents .recent {
  flex: 1;
  min-width: 0;
}

/* Only on hover: the list is for opening things, and a column of ✕ reads as a list of
   things to delete. */
.forget {
  flex: none;
  padding: var(--space-1);
  background: none;
  border-color: transparent;
  color: var(--fg-subtle);
  opacity: 0;
}

.recents li:hover .forget {
  opacity: 1;
}

.forget:hover {
  color: var(--danger);
}

.open-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: center;
}

.dismiss {
  flex: none;
  padding: 0 var(--space-1);
  background: none;
  border-color: transparent;
  color: inherit;
}

.welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.panel {
  width: min(480px, 90%);
  text-align: center;
}

h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 300;
  letter-spacing: -0.02em;
}

.tagline {
  margin: var(--space-2) 0 var(--space-4);
  color: var(--fg-muted);
}

.actions {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
}

.error {
  margin-top: var(--space-3);
  color: var(--danger);
  font-size: var(--text-sm);
}

.recents {
  margin-top: var(--space-5);
  text-align: left;
}

h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
}

.recent {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  border: none;
  background: none;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  text-align: left;
}

.recent:hover {
  background: var(--bg-hover);
}

.name {
  font-weight: 500;
}

.path {
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  max-width: 100%;
}
</style>
