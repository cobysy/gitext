<script setup lang="ts">
/** Theme, date format, toolbar, and commit info display. */

import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import { formatAbsoluteDate, formatRelativeDate } from '@renderer/format.js';
import { choice, flag } from './fields.js';

const theme = choice('theme');
const dateFormat = choice('dateFormat');

/**
 * Three days ago, formatted the way the grid will actually format it.
 *
 * The labels used to carry a hardcoded `2026-08-03 14:22`, which was a shape the app never
 * produces (absolute dates follow the resolved locale) and a date frozen in the past. A
 * sample is only useful if it is the real output.
 */
const SAMPLE_SECONDS = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
const commitInfoPosition = choice('commitInfoPosition');
const toolbarLabels = choice('toolbarLabels');
const authorInitials = flag('authorInitials');

const THEMES = [
  { value: 'system', label: 'Follow system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];
const DATE_FORMATS = [
  { value: 'relative', label: `Relative (${formatRelativeDate(SAMPLE_SECONDS)})` },
  { value: 'absolute', label: `Absolute (${formatAbsoluteDate(SAMPLE_SECONDS)})` }
];
const TOOLBAR_LABELS = [
  { value: 'all', label: 'Icon and label' },
  { value: 'none', label: 'Icon only' }
];
const COMMIT_INFO_POSITIONS = [
  { value: 'left', label: 'Left of the revision grid' },
  { value: 'right', label: 'Right of the revision grid' }
];
</script>

<template>
  <div class="form">
    <FormSelect v-model="theme" label="Theme" :options="THEMES" />
    <FormSelect v-model="dateFormat" label="Dates" :options="DATE_FORMATS" />
    <FormSelect
      v-model="toolbarLabels"
      label="Toolbar buttons"
      :options="TOOLBAR_LABELS"
      hint="Every button, or none of them."
    />
    <FormSelect
      v-model="commitInfoPosition"
      label="Commit info"
      :options="COMMIT_INFO_POSITIONS"
      hint="As tall as the grid."
    />
    <FormCheck
      v-model="authorInitials"
      label="Show author initials"
      hint="Instead of the full name."
    />
  </div>
</template>
