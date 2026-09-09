<script setup lang="ts">
/**
 * Advanced options fold: keeps form to common case. Summary shows non-default
 * values when closed, prevents silent hidden settings. Pairs with window-to-content fitting.
 */

import Twisty from '@renderer/components/ui/Twisty.vue';

const open = defineModel<boolean>({ default: false });

withDefaults(
  defineProps<{
    label?: string;
    /** Non-default values, shown when closed. */
    summary?: string;
  }>(),
  { label: 'Advanced options', summary: '' }
);
</script>

<template>
  <div class="disclosure">
    <button class="toggle" :aria-expanded="open" @click="open = !open">
      <Twisty :open="open" />
      <span>{{ label }}</span>
      <!-- Hidden while open: controls show their state. -->
      <span v-if="!open && summary" class="summary truncate">{{ summary }}</span>
    </button>

    <div v-if="open" class="panel">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.disclosure {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Twisty and text, not button chrome: reveals form, doesn't act. */
.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: var(--text-sm);
  text-align: left;
  min-width: 0;
}

.toggle:hover:not(:disabled) {
  background: none;
  color: var(--fg);
}

/* Non-default values while folded: accented so it's noticed. */
.summary {
  color: var(--accent);
  min-width: 0;
}

/* Indented with left rule: shows panel belongs to row above. */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-left: var(--space-3);
  margin-left: 5px;
  border-left: 1px solid var(--border-subtle);
}
</style>
