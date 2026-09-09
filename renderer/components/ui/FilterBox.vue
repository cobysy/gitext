<script setup lang="ts">
/**
 * Filter box shared by three lists: button inside (space-constrained).
 * Clears on × or Esc (only if something to clear), re-focuses for chaining searches.
 */

import { ref } from 'vue';
import { KEY_ESCAPE } from '@renderer/keys.js';

const model = defineModel<string>({ required: true });

withDefaults(
  defineProps<{
    placeholder?: string;
    /** Smaller type and tighter padding, for a filter that shares a one-line toolbar. */
    dense?: boolean;
  }>(),
  { placeholder: 'Filter', dense: false }
);

/** Keys the box does not claim, so the owner can move focus out of it. */
const emit = defineEmits<{ keydown: [KeyboardEvent] }>();


const input = ref<HTMLInputElement | null>(null);

function clear(): void
{
  model.value = '';
  input.value?.focus();
}

function onKeydown(event: KeyboardEvent): void
{
  // Only while there is a filter: an empty box has nothing to undo, and swallowing
  // Escape there would keep it from closing whatever the box is sitting in.
  if (event.key === KEY_ESCAPE && model.value)
  {
    event.preventDefault();
    event.stopPropagation();
    clear();
    return;
  }
  emit('keydown', event);
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="filter-box" :class="{ dense }">
    <input
      ref="input"
      v-model="model"
      type="search"
      :placeholder="placeholder"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <button
      v-if="model"
      class="clear"
      type="button"
      title="Clear the filter (Esc)"
      aria-label="Clear the filter"
      @click="clear"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.filter-box {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

input {
  width: 100%;
  min-width: 0;
  padding: 3px var(--space-2);
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  outline: none;
}

/* Room for the button, so a long search term does not run underneath it. */
input:not(:placeholder-shown) {
  padding-right: 20px;
}

/* Disable native WebKit search button (ignores theme; use custom one below). */
input::-webkit-search-cancel-button {
  appearance: none;
}

.clear {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--fg-subtle);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: default;
}

.clear:hover {
  color: var(--fg);
  background: var(--bg-hover);
}

.dense input {
  font-size: var(--text-xs);
  padding: 1px var(--space-2);
}

.dense input:not(:placeholder-shown) {
  padding-right: 18px;
}

.dense .clear {
  right: 3px;
  width: 14px;
  height: 14px;
}
</style>
