<script setup lang="ts">
/**
 * Commit summary display: read-only half of CommitPicker (dialog has no revision grid).
 * Fetches own summary (not prop) to avoid stale subject in payload.
 */

import { ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { formatCommitDate } from '@renderer/format.js';
import type { RevisionSummary } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import FormRow from '@renderer/components/ui/FormRow.vue';

const props = withDefaults(
  defineProps<{
    /** A SHA, a tag, a branch: anything git resolves. Annotated tags are peeled. */
    rev: string;
    label?: string;
  }>(),
  { label: 'Commit' }
);

const repo = useRepoStore();
const settings = useSettingsStore();

const summary = ref<RevisionSummary | null>(null);
/** Told apart from "not asked yet", so the row does not flash "not found" while loading. */
const resolved = ref(false);

watch(
  () => props.rev,
  async (rev) =>
  {
    summary.value = null;
    resolved.value = false;
    const path = repo.repo?.path;
    if (!rev || !path)
    {
      resolved.value = true;
      return;
    }
    const next = await api['repo:revision'](path, rev);
    // The operand can change while git is answering: a picker, or a payload replaced.
    if (props.rev !== rev)
    {
      return;
    }
    summary.value = next;
    resolved.value = true;
  },
  { immediate: true }
);
</script>

<template>
  <FormRow :label="props.label" stacked>
    <div class="summary">
      <template v-if="summary">
        <div class="line">
          <code class="sha selectable">{{ summary.shortSha }}</code>
          <span class="subject truncate" :title="summary.subject">{{ summary.subject }}</span>
        </div>
        <span class="who">
          {{ summary.author }} · {{ formatCommitDate(summary.date, settings.settings.dateFormat) }}
        </span>
      </template>
      <!-- A ref that no longer resolves: say so with the name that was asked for, rather
           than an empty box that reads as a dialog that failed to load. -->
      <span v-else-if="resolved" class="placeholder">
        <code>{{ props.rev }}</code>: no such revision
      </span>
      <span v-else class="placeholder">Reading…</span>
    </div>
  </FormRow>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.sha {
  flex: none;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}

.who {
  color: var(--fg-subtle);
  font-size: var(--text-sm);
}
</style>
