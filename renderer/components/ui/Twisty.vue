<script setup lang="ts">
/**
 * The chevron on a row you can fold: the left panel's sections, and every file list's
 * folders. Four lists drew their own, two as a text `›` and two as this chevron, at
 * three widths and three transition lengths, all rotating by the same 90 degrees.
 *
 * It keeps its width when there is nothing to fold (`expandable`), because the rows
 * under it are indented from its edge and a row that dropped it would sit a chevron to
 * the left of its siblings.
 *
 * Shape only: no colour. Where the chevron sits decides that, and the answers differ.
 * A panel row wants it quieter than its own text; a folder row wants exactly its text;
 * a disclosure's has to follow the button it is inside, including on hover.
 */

withDefaults(defineProps<{ open?: boolean; expandable?: boolean }>(), {
  open: false,
  expandable: true
});
</script>

<template>
  <span class="twisty" :class="{ open }">
    <svg v-if="expandable" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path
        d="M4 2.5 8 6l-4 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</template>

<style scoped>
.twisty {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  transition: transform 100ms ease;
}

.twisty.open {
  transform: rotate(90deg);
}
</style>
