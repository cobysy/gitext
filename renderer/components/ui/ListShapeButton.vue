<script setup lang="ts">
/**
 * The button in a file list's header that opens the menu of list shapes: flat, a tree
 * of folders, grouped by extension, grouped by status. Both file lists offer it, over
 * different menus, and had drawn it twice: one as a tree glyph with the full set of
 * menu-button attributes, the other as a bare `⋯` with none of them.
 *
 * The menu itself stays with the caller. The commit screen's lists open a different one
 * from the changed-file pane's, and both resolve it through the registry the way every
 * other menu in the app does.
 */

const emit = defineEmits<{ open: [MouseEvent] }>();

const LABEL = 'How the file list is grouped';
</script>

<template>
  <button
    class="view"
    type="button"
    :title="LABEL"
    :aria-label="LABEL"
    aria-haspopup="menu"
    @click="emit('open', $event)"
  >
    <!-- A parent with two children hanging off it: the shape of a tree, which is what
         the button switches the list into. -->
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
        <path d="M3 3.5h10.5" />
        <path d="M4.6 4.6v6.9" />
        <path d="M4.6 7.6h4M4.6 11.5h4" />
      </g>
      <g fill="currentColor">
        <circle cx="10.4" cy="7.6" r="1.5" />
        <circle cx="10.4" cy="11.5" r="1.5" />
      </g>
    </svg>
  </button>
</template>

<style scoped>
.view {
  flex: none;
  display: flex;
  align-items: center;
  padding: 2px 4px;
  border: none;
  background: none;
  color: var(--fg-muted);
}

.view:hover:not(:disabled) {
  background: none;
  color: var(--fg);
}
</style>
