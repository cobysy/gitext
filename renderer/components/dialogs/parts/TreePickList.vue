<script setup lang="ts" generic="T extends PathEntry">
/**
 * A manager's master list drawn as a tree you pick out of: folder rows that fold and
 * pick everything under them, entry rows with a second line the caller writes. What is
 * picked is `useTreePicks`'; this only draws it and reports the clicks.
 */

import { ROW_KIND_FOLDER, type FileRow, type PathEntry } from '@renderer/filetree.js';
import Twisty from '@renderer/components/ui/Twisty.vue';

defineProps<{
  rows: readonly FileRow<T>[];
  isPicked: (row: FileRow<T>) => boolean;
  /** Said in the list when there are no rows. */
  empty: string;
}>();

const emit = defineEmits<{
  pick: [row: FileRow<T>, event: MouseEvent];
  toggle: [key: string];
}>();

defineSlots<{
  /** The entry's second line, drawn by the caller, which owns whether it has one. */
  detail(props: { row: FileRow<T> }): unknown;
}>();
</script>

<template>
  <ul class="list side">
    <li v-if="!rows.length" class="placeholder">{{ empty }}</li>
    <li v-for="row in rows" :key="row.key">
      <button
        v-if="row.kind === ROW_KIND_FOLDER"
        class="entry folder"
        :class="{ current: isPicked(row) }"
        :style="{ '--depth': row.depth }"
        @click="emit('pick', row, $event)"
      >
        <span class="fold" @click.stop="emit('toggle', row.key)">
          <Twisty :open="row.expanded" />
        </span>
        <span class="title truncate">{{ row.label }}/</span>
        <span class="count">{{ row.count }}</span>
      </button>
      <button
        v-else
        class="entry"
        :class="{ current: isPicked(row) }"
        :style="{ '--depth': row.depth }"
        @click="emit('pick', row, $event)"
      >
        <span class="title truncate" :title="row.key">{{ row.label }}</span>
        <slot name="detail" :row="row" />
      </button>
    </li>
  </ul>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped>
/* A name or a path is read character by character. */
.entry .title {
  font-family: var(--font-mono);
}

/* Each level of the tree steps in by one twisty's width, the way the panel's does. */
.entry {
  padding-left: calc(var(--space-2) + var(--depth, 0) * var(--space-4));
}

/* A folder is one line: the twisty that folds it, its name, and how many it holds. */
.entry.folder {
  flex-direction: row;
  align-items: center;
  gap: var(--space-1);
}

.entry.folder .count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

.fold {
  display: inline-flex;
}
</style>
