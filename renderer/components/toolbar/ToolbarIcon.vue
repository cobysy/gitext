<script setup lang="ts">
/**
 * Toolbar button glyphs. Inline SVG in currentColor so they dim with disabled buttons
 * and follow themes. Keyed by command id.
 */

import GlyphShapes from '@renderer/components/ui/GlyphShapes.vue';

defineProps<{ id: string }>();

const COMMAND_ID_COMMIT_OPEN = 'commit.open';
const COMMAND_ID_REMOTE_PULL = 'remote.pull';
const COMMAND_ID_REMOTE_PUSH = 'remote.push';
const COMMAND_ID_REMOTE_FETCH_ALL = 'remote.fetchAll';
const COMMAND_ID_STASH = 'stash';
const COMMAND_ID_VIEW_REFRESH = 'view.refresh';
const COMMAND_ID_SUBMODULE_MANAGE = 'submodule.manage';
const COMMAND_ID_WORKTREE_MANAGE = 'worktree.manage';
const COMMAND_ID_MAINTENANCE = 'maintenance';
const COMMAND_ID_REPO_REVEAL = 'repo.reveal';
const COMMAND_ID_SETTINGS_OPEN = 'settings.open';
</script>

<template>
  <svg class="icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <g v-if="id === COMMAND_ID_COMMIT_OPEN" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.2v3.7M8 11.1v3.7" stroke-linecap="round" />
    </g>
    <!-- Pull: down into the working tree. Push: up out of it. Fetch: both, no merge. -->
    <g v-else-if="id === COMMAND_ID_REMOTE_PULL" fill="none" stroke="currentColor" stroke-width="1.3">
      <path d="M8 1.8v8.4" stroke-linecap="round" />
      <path d="M4.6 6.8 8 10.2l3.4-3.4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M2.4 13.4h11.2" stroke-linecap="round" />
    </g>
    <g v-else-if="id === COMMAND_ID_REMOTE_PUSH" fill="none" stroke="currentColor" stroke-width="1.3">
      <path d="M8 13.4V5" stroke-linecap="round" />
      <path d="M4.6 8.4 8 5l3.4 3.4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M2.4 2.2h11.2" stroke-linecap="round" />
    </g>
    <g v-else-if="id === COMMAND_ID_REMOTE_FETCH_ALL" fill="none" stroke="currentColor" stroke-width="1.3">
      <path d="M5 2.6v8.6M11 13.4V4.8" stroke-linecap="round" />
      <path d="M2.6 8.8 5 11.2l2.4-2.4M8.6 7.2 11 4.8l2.4 2.4" stroke-linecap="round" stroke-linejoin="round" />
    </g>
    <GlyphShapes v-else-if="id === COMMAND_ID_STASH" name="stash" />
    <g v-else-if="id === COMMAND_ID_VIEW_REFRESH" fill="none" stroke="currentColor" stroke-width="1.3">
      <path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.85" stroke-linecap="round" />
      <path d="M13.4 1.8v3.1h-3.1" stroke-linecap="round" stroke-linejoin="round" />
    </g>
    <g v-else-if="id === COMMAND_ID_SUBMODULE_MANAGE" fill="none" stroke="currentColor" stroke-width="1.2">
      <rect x="2.4" y="2.4" width="7.4" height="7.4" rx="1" />
      <rect x="6.2" y="6.2" width="7.4" height="7.4" rx="1" />
    </g>
    <GlyphShapes v-else-if="id === COMMAND_ID_WORKTREE_MANAGE" name="folder" />
    <!-- A brush over a surface: sweeping up after the work, which is what every row of
         this menu does. -->
    <g v-else-if="id === COMMAND_ID_MAINTENANCE" fill="none" stroke="currentColor" stroke-width="1.3">
      <path d="M9.2 1.8 6 5" stroke-linecap="round" />
      <path d="M4.4 4.2 8.4 8.2l-2.2 2.2a2.8 2.8 0 0 1-4-4z" stroke-linejoin="round" />
      <path d="M2.6 13.8h10.8" stroke-linecap="round" />
    </g>
    <g v-else-if="id === COMMAND_ID_REPO_REVEAL" fill="none" stroke="currentColor" stroke-width="1.2">
      <path d="M2.2 4.4h4l1.2 1.6h3.2" stroke-linejoin="round" />
      <path d="M2.2 4.4v8.2a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9" stroke-linejoin="round" />
      <path d="M9.6 6 14 1.8M10.6 1.8H14v3.4" stroke-linecap="round" stroke-linejoin="round" />
    </g>
    <g v-else-if="id === COMMAND_ID_SETTINGS_OPEN" fill="none" stroke="currentColor" stroke-width="1.3">
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.4v1.4M8 13.2v1.4M1.4 8h1.4M13.2 8h1.4M3.45 3.45l1 1M11.55 11.55l1 1M3.45 12.55l1-1M11.55 4.45l1-1" stroke-linecap="round"/>
    </g>
    <circle v-else cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.3" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
}
</style>
