<script setup lang="ts">
/**
 * Repo switcher toolbar button. Shows open repo and nearby:
 * superproject, submodule, recent. Not ContextMenu.
 *
 * The repository only. The branch used to be drawn here too, and once the toolbar grew a
 * branch control of its own the name sat twice in the same strip, two pixels apart. Each
 * of the two names one thing and opens what can be done to it.
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { buildSwitcherSections, type SwitcherEntry } from '@renderer/switcher.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { TOAST_TONE_ERROR, TOAST_TONE_INFO, useUiStore } from '@renderer/stores/ui.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { runCommand } from '@renderer/commands/registry.js';

const repoStore = useRepoStore();
const objects = useRepoObjectsStore();
const settings = useSettingsStore();
const ui = useUiStore();
const commandContext = useCommandContext();

const COMMAND_ID_OPEN_REPO = 'repo.open';

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

const name = computed(() => repoStore.repo?.name ?? '');

const sections = computed(() =>
  buildSwitcherSections({
    currentPath: repoStore.repo?.path ?? null,
    superprojectPath: repoStore.repo?.superprojectPath ?? null,
    submodules: objects.submodules,
    recentRepos: settings.settings.recentRepos
  })
);

function toggle(): void
{
  open.value = !open.value;
}

function close(): void
{
  if (!open.value)
  {
    return;
  }
  open.value = false;
  root.value?.querySelector<HTMLElement>('button')?.focus();
}

async function choose(entry: SwitcherEntry): Promise<void>
{
  if (!entry.enabled)
  {
    return;
  }
  close();
  const opened = await repoStore.open(entry.path);
  // `repoStore.error` is shown on the welcome screen, which is not on screen while a
  // repository is open: so a failed switch would otherwise leave the old repository up
  // with nothing saying the click did anything.
  if (!opened && repoStore.error)
  {
    ui.toast(repoStore.error, TOAST_TONE_ERROR);
  }
}

async function runRow(id: string): Promise<void>
{
  close();
  const ran = await runCommand(id, commandContext.value);
  if (!ran)
  {
    ui.toast(`"${id}" is not available yet.`, TOAST_TONE_INFO);
  }
}

/** Click anywhere else closes it: `mousedown`, so it beats the next control's click. */
function onDocumentMouseDown(event: MouseEvent): void
{
  if (!root.value?.contains(event.target as Node))
  {
    close();
  }
}

watch(open, (isOpen) =>
{
  if (isOpen)
  {
    document.addEventListener('mousedown', onDocumentMouseDown, true);
    void nextTick(() => panel.value?.querySelector<HTMLElement>('button')?.focus());
  }
  else
  {
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
  }
});

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentMouseDown, true));
</script>

<template>
  <div ref="root" class="switcher" @keydown.esc.stop="close">
    <button
      class="current"
      :title="repoStore.repo?.path"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span class="name">{{ name }}</span>
      <svg class="chevron" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true">
        <path d="M1 1.4 5 5l4-3.6" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="open" ref="panel" class="popover" role="menu">
      <section v-for="section in sections" :key="section.label">
        <h3>{{ section.label }}</h3>
        <button
          v-for="entry in section.entries"
          :key="entry.path"
          class="entry"
          role="menuitem"
          :disabled="!entry.enabled"
          :title="entry.enabled ? entry.path : `${entry.path}, ${entry.reason}`"
          @click="choose(entry)"
        >
          <span class="entry-name">{{ entry.name }}</span>
          <span class="entry-path truncate">{{ entry.reason ?? entry.path }}</span>
        </button>
      </section>

      <div class="footer">
        <button class="entry plain" role="menuitem" @click="runRow(COMMAND_ID_OPEN_REPO)">
          Open Repository…
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
  flex: none;
}

.current {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  max-width: 260px;
  padding: 3px var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  font-size: var(--text-sm);
}

.current:hover {
  background: var(--bg-hover);
}

.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  flex: none;
  color: var(--fg-subtle);
  align-self: center;
}

.popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 110;
  min-width: 280px;
  max-width: 420px;
  max-height: 60vh;
  overflow-y: auto;
  padding: var(--space-1) 0;
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

h3 {
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.entry {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: var(--space-1) var(--space-3);
  border: none;
  background: none;
  text-align: left;
  font-size: var(--text-sm);
}

.entry:hover:not(:disabled),
.entry:focus-visible {
  background: var(--bg-hover);
}

.entry:disabled {
  opacity: 0.5;
}

.entry-path {
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  max-width: 100%;
}

.footer {
  border-top: 1px solid var(--border-subtle);
  margin-top: var(--space-1);
  padding-top: var(--space-1);
}

.entry.plain {
  flex-direction: row;
  align-items: center;
}
</style>
