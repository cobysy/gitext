<script setup lang="ts">
/**
 * Render text with backtick-marked git tokens in code font. Without this, `--no-ff`
 * reads as broken punctuation, and `fix` looks like a word. No wrapper: segments only,
 * so the caller keeps its element.
 */

import { computed } from 'vue';
import { codeSegments } from '@renderer/model/codeText.js';

const props = defineProps<{ text: string }>();

const segments = computed(() => codeSegments(props.text));
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <code v-if="segment.code">{{ segment.value }}</code>
    <template v-else>{{ segment.value }}</template>
  </template>
</template>
