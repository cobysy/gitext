<script setup lang="ts">
/**
 * Panel node glyph: inline SVG in `currentColor` so it inherits the row's colour
 * and dims automatically without a second asset.
 */

import {
  KIND_BRANCH,
  KIND_FOLDER,
  KIND_REMOTE,
  KIND_REMOTE_BRANCH,
  KIND_STASH,
  KIND_SUBMODULE,
  KIND_TAG,
  KIND_WORKTREE,
  type PanelNodeKind
} from '@renderer/panel.js';
import GlyphShapes from '@renderer/components/ui/GlyphShapes.vue';

defineProps<{
  kind: PanelNodeKind;
  /**
   * A branch already contained in the selected commit. Drawn as a tick beside the
   * branch glyph rather than as a colour: colour in this panel means "you are here".
   */
  merged?: boolean;
}>();
</script>

<template>
  <svg class="icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <g v-if="kind === KIND_BRANCH || kind === KIND_REMOTE_BRANCH" fill="currentColor">
      <path
        d="M5 3.5a1.5 1.5 0 1 0-2 1.415V11.1A1.5 1.5 0 1 0 5 12.5a1.5 1.5 0 0 0-1-1.415V8.7c.5.5 1.2.8 2 .8h1.5A2.5 2.5 0 0 0 11 7.1V4.9a1.5 1.5 0 1 0-1 0v2.2A1.5 1.5 0 0 1 8.5 8.6H7A2 2 0 0 1 5 6.6Z"
      />
      <path
        v-if="merged"
        class="tick"
        d="M9.4 11.6 11.6 13.8 15.4 9.2"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <g v-else-if="kind === KIND_REMOTE" fill="none" stroke="currentColor" stroke-width="1.2">
      <circle cx="8" cy="8" r="5.4" />
      <ellipse cx="8" cy="8" rx="2.4" ry="5.4" />
      <path d="M2.8 6.2h10.4M2.8 9.8h10.4" />
    </g>
    <g v-else-if="kind === KIND_TAG" fill="none" stroke="currentColor" stroke-width="1.2">
      <path d="M8.2 2.4H13v4.8l-6 6-4.8-4.8z" stroke-linejoin="round" />
      <circle cx="10.6" cy="5" r="0.9" fill="currentColor" stroke="none" />
    </g>
    <GlyphShapes v-else-if="kind === KIND_STASH" name="stash" />
    <g v-else-if="kind === KIND_SUBMODULE" fill="none" stroke="currentColor" stroke-width="1.2">
      <rect x="2.4" y="2.4" width="7.4" height="7.4" rx="1" />
      <rect x="6.2" y="6.2" width="7.4" height="7.4" rx="1" />
    </g>
    <!-- A worktree is a folder somewhere else on disk, and draws as one. -->
    <GlyphShapes
      v-else-if="kind === KIND_WORKTREE || kind === KIND_FOLDER"
      name="folder"
    />
  </svg>
</template>

<style scoped>
/* Green, large enough to survive 13px. At subtle grey it would be invisible at real size.
   Green is the panel's only other meaningful colour, making unmarked branches stand out. */
.tick {
  color: var(--success);
}

.icon {
  flex: none;
  /* Optically centred against the row's text rather than its box. */
  margin-top: -1px;
}
</style>
