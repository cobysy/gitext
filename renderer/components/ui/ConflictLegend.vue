<script setup lang="ts">
/**
 * Legend for conflict-action icons. Icons trade width for legibility; they only work
 * if the meaning is explained. Component is layout; caller supplies items.
 */

import ConflictIcon from './ConflictIcon.vue';
import type { ConflictIconName } from './conflictIcons.js';

defineProps<{ items: readonly { icon: ConflictIconName; label: string }[] }>();
</script>

<template>
  <p class="legend">
    <span v-for="item in items" :key="item.icon" class="entry">
      <ConflictIcon :name="item.icon" />
      {{ item.label }}
    </span>
  </p>
</template>

<style scoped>
/* Wrap on narrow: cut-off legend explains nothing. */
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.entry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
