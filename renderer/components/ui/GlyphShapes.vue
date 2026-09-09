<script setup lang="ts">
/**
 * One shared glyph's shapes, with no `<svg>` around them: for a component that already
 * has one of its own and draws this glyph as one case among its own. `Glyph.vue` is the
 * standalone form.
 */

import { computed } from 'vue';
import { GLYPHS, type GlyphName } from './glyphs.js';

const props = defineProps<{ name: GlyphName }>();

const glyph = computed(() => GLYPHS[props.name]);
</script>

<template>
  <g
    fill="none"
    stroke="currentColor"
    :stroke-width="glyph.strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path v-for="d in glyph.paths" :key="d" :d="d" />
  </g>
</template>
