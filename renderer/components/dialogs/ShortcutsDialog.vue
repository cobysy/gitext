<script setup lang="ts">
/**
 * Shortcut reference from registry. Newspaper columns, fixedHeight
 * (prevents oversized window).
 */

import { computed } from 'vue';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { registerCommands } from '@renderer/commands/index.js';
import { allCommands, isImplemented, scopePanes, type PaneId } from '@renderer/commands/registry.js';
import { formatAccelerator } from '@renderer/keys.js';

const emit = defineEmits<{ close: [] }>();

// This dialog is its own window, and a dialog window mounts `DialogHost`, not `App.vue`
//: so nothing has filled the registry that this page is a reading of. Without this the
// dialog rendered completely empty. Idempotent, so it costs nothing wherever the
// registry is already built.
registerCommands();

/** Where a scoped binding works, in the words the rest of the UI uses for those panes. */
const PANE_NAMES: Record<PaneId, string> = {
  grid: 'revision grid',
  fileList: 'file list',
  diff: 'diff pane',
  leftPanel: 'left panel',
  commitScreen: 'commit screen'
};

/**
 * Where a binding works, in words, or '' when the surrounding heading already said it.
 *
 * A group whose every command shares one pane is a group whose heading is that pane, and
 * repeating it per row is noise the reader has to skip on the way to the keys.
 */
function scopeNote(group: string, panes: readonly PaneId[]): string
{
  const named = panes.map((pane) => PANE_NAMES[pane]);
  if (named.length === 1 && group.toLowerCase() === named[0])
  {
    return '';
  }
  return named.join(' or the ');
}

const groups = computed(() =>
{
  const byGroup = new Map<string, { label: string; keys: string; where: string }[]>();
  for (const command of allCommands())
  {
    // A declared-but-unbuilt command may already own its binding; listing it here
    // would promise a shortcut that does nothing.
    if (!command.keys?.length || !isImplemented(command))
    {
      continue;
    }
    const entries = byGroup.get(command.group) ?? [];
    entries.push({
      label: command.label,
      keys: formatAccelerator(command.keys[0]!),
      // A bare `R` that works in one pane and nowhere else is a shortcut nobody can use
      // unless the reference says where. Blank for the window-wide ones, which is most.
      // `S` works in two, and naming both is the only way to say that the same key does
      // the same thing on the commit screen.
      // …except where the group heading already says it. Every row under COMMIT SCREEN
      // carried "in the commit screen", eight times in a column, under a heading reading
      // "COMMIT SCREEN".
      where: scopeNote(command.group, scopePanes(command.scope))
    });
    byGroup.set(command.group, entries);
  }
  return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
});
</script>

<template>
  <DialogFrame title="Keyboard Shortcuts" fixed-height @close="emit('close')">
    <div class="columns">
      <section v-for="[group, entries] in groups" :key="group" class="group">
        <h3>{{ group }}</h3>
        <div v-for="entry in entries" :key="entry.label" class="row">
          <span class="what">
            {{ entry.label }}
            <span v-if="entry.where" class="where">in the {{ entry.where }}</span>
          </span>
          <kbd>{{ entry.keys }}</kbd>
        </div>
      </section>
    </div>

    <template #actions>
      <button class="primary" @click="emit('close')">Close</button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/dialogSection.css"></style>
<style scoped>
/* Newspaper columns rather than a grid: the groups are different lengths and each one
   only has to stay whole, which is exactly what `column-count` does and what a two-track
   grid would need a balancing pass to fake. */
.columns {
  column-count: 2;
  column-gap: var(--space-5);
}

.group {
  break-inside: avoid;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}

.what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Under the command rather than beside it: in a column half the window wide there is no
   room for three things on a line, and it is a condition on the binding rather than part
   of what the command is called. */
.where {
  color: var(--fg-subtle);
  font-size: var(--text-xs);
}

kbd {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1px var(--space-2);
}
</style>
