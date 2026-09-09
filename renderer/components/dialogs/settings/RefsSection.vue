<script setup lang="ts">
/**
 * Which refs the grid walks and draws. Separate from Revisions because this is one
 * question: what history is on screen.
 */

import { ref, watch } from 'vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import { BRANCH_SCOPE_FILTERED, useSettingsStore } from '@renderer/stores/settings.js';
import { choice, flag } from './fields.js';

const store = useSettingsStore();

const branchScope = choice('branchScope');
// Manual ref, not choice(): choice() patches on every update, saving incomplete patterns.
// Watch follows updates from elsewhere (e.g. Reset to Defaults).
const branchFilter = ref(store.settings.branchFilter);
watch(
  () => store.settings.branchFilter,
  (value) => (branchFilter.value = value)
);

function saveBranchFilter(): void
{
  void store.patch({ branchFilter: branchFilter.value });
}

const logShowRemoteBranches = flag('logShowRemoteBranches');
const logShowTags = flag('logShowTags');
const logShowStashes = flag('logShowStashes');
const logShowReflog = flag('logShowReflog');

const BRANCH_SCOPES = [
  { value: 'all', label: 'All branches' },
  { value: 'current', label: 'Current branch only' },
  { value: BRANCH_SCOPE_FILTERED, label: 'Filtered branches, the pattern below' }
];
</script>

<template>
  <div class="form">
    <FormSelect v-model="branchScope" label="Branch scope" :options="BRANCH_SCOPES" />
    <FormText
      v-model="branchFilter"
      label="Branch filter pattern"
      placeholder="main release-* origin/develop"
      hint="Names or wildcards (*, ?, [...]), space-separated."
      :disabled="branchScope !== BRANCH_SCOPE_FILTERED"
      @change="saveBranchFilter"
    />
    <FormCheck v-model="logShowRemoteBranches" label="Show remote branches" />
    <FormCheck v-model="logShowTags" label="Show tags" />
    <FormCheck v-model="logShowStashes" label="Show stashes" />
    <FormCheck
      v-model="logShowReflog"
      label="Show reflog references"
      hint="`--reflog`: every commit the reflog still names."
    />
  </div>
</template>
