<script setup lang="ts">
/**
 * A button that deletes something: the bin before its label, so it reads as the
 * destructive one before the words are read. Everything else is the caller's, and
 * reaches the `<button>` as it would a plain one: the class that says how loud it is
 * (`danger`, `primary`, a row's quiet `.del`), `disabled`, and the click.
 */

import Glyph from './Glyph.vue';
</script>

<template>
  <button class="deletes">
    <Glyph name="trash" />
    <slot />
  </button>
</template>

<style scoped>
.deletes {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
}
</style>
