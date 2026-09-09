<script setup lang="ts">
/**
 * Warning or danger note for destructive dialogs. Tone distinguishes what will happen
 * (warning) from what already failed (danger).
 */

const TONE_DANGER = 'danger';

withDefaults(defineProps<{ tone?: 'warning' | 'danger' }>(), { tone: TONE_DANGER });
</script>

<template>
  <p class="note" :class="tone" role="note">
    <slot />
  </p>
</template>

<style scoped>
.note {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.note.danger {
  border-color: var(--danger);
  color: var(--danger);
}

.note.warning {
  border-color: var(--warning);
  color: var(--warning);
}
</style>
