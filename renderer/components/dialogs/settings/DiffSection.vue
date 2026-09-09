<script setup lang="ts">
/** Diff display and whitespace handling. */

import FormSelect from '@renderer/components/ui/FormSelect.vue';
import { choice } from './fields.js';

const diffViewMode = choice('diffViewMode');
const diffIgnoreWhitespace = choice('diffIgnoreWhitespace');

const DIFF_VIEW_MODES = [
  { value: 'sideBySide', label: 'Side by side' },
  { value: 'inline', label: 'Inline' }
];
const WHITESPACE_MODES = [
  { value: 'none', label: 'Show all whitespace changes' },
  { value: 'change', label: 'Ignore whitespace changes' },
  { value: 'all', label: 'Ignore all whitespace' }
];
</script>

<template>
  <div class="form">
    <FormSelect v-model="diffViewMode" label="View mode" :options="DIFF_VIEW_MODES" />
    <FormSelect v-model="diffIgnoreWhitespace" label="Whitespace" :options="WHITESPACE_MODES" />
  </div>
</template>
