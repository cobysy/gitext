<script setup lang="ts">
/**
 * Settings pages beside picker. One column was 2752px (scrolling nightmare).
 * Pages approach: each is own component.
 */

import { computed, ref } from 'vue';
import { DEFAULT_SETTINGS } from '@shared/types.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { SETTINGS_PAGES } from '@renderer/components/dialogs/settings/pages.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';

const emit = defineEmits<{ close: [] }>();
const store = useSettingsStore();

const pageId = ref(SETTINGS_PAGES[0]!.id);
const page = computed(() => SETTINGS_PAGES.find((entry) => entry.id === pageId.value) ?? SETTINGS_PAGES[0]!);

/**
 * Reset every field in Settings (recentRepos, dialogBounds, gridColumns, etc).
 * Confirm dialog names what it does.
 */
async function resetToDefaults(): Promise<void>
{
  const confirmed = await useUiStore().confirm({
    title: 'Reset Settings?',
    message:
      'Every setting goes back to its default. This cannot be undone.',
    confirmLabel: 'Reset Settings',
    danger: true
  });
  if (!confirmed)
  {
    return;
  }
  await store.patch({ ...DEFAULT_SETTINGS });
}
</script>

<template>
  <DialogFrame title="Settings" fixed-height @close="emit('close')">
    <div class="pages">
      <nav class="list" aria-label="Settings pages">
        <button
          v-for="entry in SETTINGS_PAGES"
          :key="entry.id"
          class="row"
          :class="{ selected: entry.id === pageId }"
          :aria-current="entry.id === pageId"
          @click="pageId = entry.id"
        >
          {{ entry.label }}
        </button>
      </nav>

      <!-- Keyed: mounts new page rather than patching controls. -->
      <div class="pane">
        <h3>{{ page.label }}</h3>
        <component :is="page.component" :key="page.id" />
      </div>
    </div>

    <template #actions>
      <button class="reset" @click="resetToDefaults">Reset to Defaults…</button>
      <button class="primary" @click="emit('close')">Done</button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/dialogSection.css"></style>
<style scoped src="@renderer/styles/listRow.css"></style>
<style scoped>
/* Window height; right pane scrolls. */
.pages {
  display: flex;
  height: 100%;
  min-height: 0;
}

.list {
  flex: none;
  width: 160px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-right: var(--space-3);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
}

/* A row of the list, not a control: no border, no fill of its own, and the text starts
   at the left edge the way a list's rows do. */
.row {
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  text-align: left;
  color: var(--fg);
}

.pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-left: var(--space-3);
}

/* A form's rows stop at a readable measure rather than filling whatever width the window
   was dragged to: a three-option select does not become a better control for being 600px
   wide, and a hint under it is a line of prose. */
.pane > * {
  max-width: 460px;
}

/* Pushed to the footer's left edge so it reads as separate from Done, not a step
   before it: resetting is not part of finishing this dialog. */
.reset {
  margin-right: auto;
  color: var(--danger);
}
</style>
