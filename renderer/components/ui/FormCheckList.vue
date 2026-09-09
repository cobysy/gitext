<script setup lang="ts">
/**
 * A boxed, scrolling column of `FormCheck`s: pick some of these, where "these" is a
 * list the repository decided the length of. Forty branches would otherwise push a
 * dialog's confirming button off the screen, so the list scrolls and the window does
 * not grow past it.
 *
 * Boxed, unlike a plain run of checks in a form, because the scroll needs an edge to
 * happen at: without one the list appears to end wherever it was cut off.
 */
</script>

<template>
  <div class="checks">
    <slot />
  </div>
</template>

<style scoped>
.checks {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-2);
  /* `--border`, not `--border-subtle`: the box indents its checks by its own padding, so
     an edge too faint to see leaves them looking misaligned against the checks outside it. */
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
</style>
