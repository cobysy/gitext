<script setup lang="ts">
/**
 * One of the shared glyphs, on its own. Decorative in every place it is used: the
 * control around it carries the label a screen reader reads, so the `<svg>` is hidden
 * rather than given a title of its own.
 */

import GlyphShapes from './GlyphShapes.vue';
import { GLYPH_VIEW_BOX, type GlyphName } from './glyphs.js';

withDefaults(defineProps<{ name: GlyphName; size?: number }>(), { size: 13 });
</script>

<template>
  <svg :viewBox="GLYPH_VIEW_BOX" :width="size" :height="size" aria-hidden="true">
    <GlyphShapes :name="name" />
  </svg>
</template>
