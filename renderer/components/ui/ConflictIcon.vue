<script setup lang="ts">
/**
 * Conflict-action icon. Shapes live in conflictIcons.ts because the merge editor's
 * per-block toolbar is raw DOM that can't mount components. v-html is safe: no user
 * data in the SVG strings.
 */

import { computed } from 'vue';
import { conflictIconSvg, type ConflictIconName } from './conflictIcons.js';

const props = withDefaults(defineProps<{ name: ConflictIconName; size?: number }>(), {
  size: 14
});

const svg = computed(() => conflictIconSvg(props.name, props.size));
</script>

<template>
  <span class="icon" v-html="svg" />
</template>

<style scoped>
/* inline-flex keeps SVG on text baseline, not descender gap. */
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
</style>
