<script setup lang="ts">
/** Grid history display settings. Which refs are walked is on the Refs page. */

import FormNumber from '@renderer/components/ui/FormNumber.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import { flag, number } from './fields.js';

/** Empty means no limit, which the contract represents as null rather than 0. */
const commitLoadLimit = number('commitLoadLimit', (value) => Math.max(1, value));
const showArtificialCommits = flag('showArtificialCommits');
const showMessageBody = flag('showMessageBody');
const showAuthorDate = flag('showAuthorDate');
const quickSearchTimeout = number('quickSearchTimeout');
</script>

<template>
  <div class="form">
    <FormNumber
      v-model="commitLoadLimit"
      label="Commit load limit"
      :min="100"
      :step="1000"
      placeholder="All"
      hint="Empty loads the whole history."
    />
    <FormCheck v-model="showArtificialCommits" label="Show working directory and index rows" />
    <FormCheck
      v-model="showMessageBody"
      label="Show commit message body"
      hint="After the subject, on the same line."
    />
    <FormCheck
      v-model="showAuthorDate"
      label="Show author date"
      hint="Instead of the committer date."
    />
    <FormNumber
      v-model="quickSearchTimeout"
      label="Quick search timeout"
      :min="200"
      :max="5000"
      :step="250"
      hint="How long typed characters join one search."
    />
    <p class="hint">
      Author, committer, message, diff-content and date-range filters are the Advanced
      Filter dialog (⌘P), and stay session-scoped: they are the search you are running
      right now, not a preference to remember between repositories.
    </p>
  </div>
</template>
