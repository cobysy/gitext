<script setup lang="ts">
/** The collapsed left panel: the control that brings it back, and one button per section. */

import { computed } from 'vue';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import {
  SECTION_KINDS,
  SECTION_LABELS,
  sectionNodeId,
  type PanelSectionId
} from '@renderer/panel.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import NodeIcon from './NodeIcon.vue';
import PanelToggleButton from './PanelToggleButton.vue';

const TOGGLE_COMMAND = 'view.toggleLeftPanel';

const objects = useRepoObjectsStore();
const context = useCommandContext();

const sections = computed(() => objects.sections);

/** The tree first, so the panel mounts already open at the row rather than moving to it. */
function openAt(id: PanelSectionId): void
{
  const node = sectionNodeId(id);
  objects.setExpanded(node, true);
  objects.select(node);
  void runCommand(TOGGLE_COMMAND, context.value);
}
</script>

<template>
  <div class="panel-rail">
    <PanelToggleButton hover-label />

    <div class="divider" />

    <button
      v-for="id in sections"
      :key="id"
      class="section has-label"
      type="button"
      :aria-label="`Show the left panel at ${SECTION_LABELS[id]}`"
      @click="openAt(id)"
    >
      <NodeIcon :kind="SECTION_KINDS[id]" />
      <span class="flyout">{{ SECTION_LABELS[id] }}</span>
    </button>
  </div>
</template>

<style scoped src="@renderer/styles/hoverLabel.css"></style>
<style scoped>
.panel-rail {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 28px;
  padding-top: var(--space-2);
  background: var(--bg-subtle);
  border-right: 1px solid var(--border);
}

.divider {
  flex: none;
  width: 14px;
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--border);
}

.section {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: default;
}

.section:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
</style>
