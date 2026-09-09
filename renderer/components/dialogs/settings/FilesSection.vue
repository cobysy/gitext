<script setup lang="ts">
/** File list display settings. */

import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import { choice, flag } from './fields.js';

const fileListView = choice('fileListView');
const fileListDenseTree = flag('fileListDenseTree');

const FILE_LIST_VIEWS = [
  { value: 'tree', label: 'Group by file path, tree' },
  { value: 'flat', label: 'Group by file path, flat' }
];
</script>

<template>
  <div class="form">
    <FormSelect v-model="fileListView" label="File list" :options="FILE_LIST_VIEWS" />
    <FormCheck
      v-model="fileListDenseTree"
      label="Dense tree"
      hint="Merges a folder with its only child."
    />
  </div>
</template>
