<script setup lang="ts">
/**
 * Hint line with git tokens in code font. Teaches the command line the dialog will run.
 */

import CodeText from './CodeText.vue';

defineProps<{ text: string }>();
</script>

<template>
  <span class="hint"><CodeText :text="text" /></span>
</template>
