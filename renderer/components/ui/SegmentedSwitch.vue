<script setup lang="ts">
/**
 * One question with two or three answers, drawn as a joined row of buttons rather than
 * a menu: the pane's first question, where one click has to be enough to change it.
 *
 * Icons rather than words, since these sit in pane headers a few pixels tall; the
 * label is the tooltip and the accessible name.
 *
 * An item is anything with an id, a label and a state. A `ResolvedCommand` from the
 * registry is one (`resolvedCommands` narrows a resolved menu to them), and so is a
 * plain object from a dialog whose switch is its own local state.
 */

export interface SegmentedItem {
  id: string;
  label: string;
  enabled: boolean;
  /** True on whichever one is the current answer. */
  checked?: boolean;
}

defineProps<{ items: readonly SegmentedItem[] }>();
const emit = defineEmits<{ run: [id: string] }>();
</script>

<template>
  <div class="modes" role="group">
    <button
      v-for="item in items"
      :key="item.id"
      class="mode"
      type="button"
      :class="{ on: item.checked }"
      :title="item.label"
      :aria-label="item.label"
      :aria-pressed="item.checked ? 'true' : 'false'"
      :disabled="!item.enabled"
      @click="emit('run', item.id)"
    >
      <slot name="icon" :id="item.id" />
    </button>
  </div>
</template>

<style scoped>
.modes {
  display: flex;
  flex: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.mode {
  border: none;
  background: var(--bg);
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  padding: 2px var(--space-2);
  cursor: pointer;
}

.mode + .mode {
  border-left: 1px solid var(--border);
}

.mode.on {
  background: var(--accent);
  color: var(--fg-on-accent);
}

/* The half that is *not* the current answer lifts on hover. The one that is keeps its
   accent and only deepens: a hover that repainted it like the other half would read as
   the mode having switched back under the pointer. */
.mode:hover:not(:disabled):not(.on) {
  background: var(--bg-hover);
  color: var(--fg);
}

.mode.on:hover:not(:disabled) {
  background: var(--accent-hover);
}

.mode:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
