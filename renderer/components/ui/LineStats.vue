<script setup lang="ts">
/**
 * What a change did, in lines: `+12 −3`, the counts `--numstat` prints. Two surfaces
 * draw it, the file list's rows and the diff pane's bar, so the colours and the minus
 * sign are settled here rather than twice.
 */

defineProps<{
  added: number;
  deleted: number;
  /**
   * Fixed-width numbers, for a list: the counts then read down the pane as a column
   * instead of ending wherever each name does.
   */
  column?: boolean;
}>();
</script>

<template>
  <span class="stats" :class="{ column }">
    <span class="added">+{{ added }}</span>
    <span class="deleted">−{{ deleted }}</span>
  </span>
</template>

<style scoped>
.stats {
  display: flex;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  flex: none;
}

.stats.column {
  font-variant-numeric: tabular-nums;
}

.stats.column > span {
  min-width: 3ch;
  text-align: right;
}

.added {
  color: var(--success);
}

.deleted {
  color: var(--danger);
}
</style>
