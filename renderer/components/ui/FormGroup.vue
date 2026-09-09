<script setup lang="ts">
/**
 * Labelled box around related controls (fieldset + legend). Helps readers understand
 * that controls belong together.
 */

defineProps<{
  label: string;
  /** Hide the box when it doesn't apply. */
  collapsed?: boolean;
}>();
</script>

<template>
  <fieldset v-if="!collapsed" class="group">
    <legend>{{ label }}</legend>
    <div class="body">
      <slot />
    </div>
  </fieldset>
</template>

<style scoped>
.group {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  min-width: 0;
}

legend {
  padding: 0 var(--space-1);
  color: var(--fg-muted);
  font-size: var(--text-sm);
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
