<script setup lang="ts">
/**
 * One end of a comparison: card showing identity, subject, author/date (dates catch inverted comparisons).
 * Shows resolved SHA for reproducibility. Filter-first picker shared with Go to Commit dialog.
 */

import { computed, nextTick, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import { formatCommitDate, shortSha } from '@renderer/format.js';
import {
  ENDPOINT_KIND_COMMIT,
  ENDPOINT_KIND_INDEX,
  ENDPOINT_KIND_WORKING_TREE,
  type DiffEndpoint
} from '@shared/diff.js';
import type { RevisionChoice } from '@renderer/model/revisionChoices.js';
import type { SlotRevision } from './slotRevision.js';
import type { CommitSummary } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import RevisionPicker from './RevisionPicker.vue';


const model = defineModel<SlotRevision>({ required: true });

const props = defineProps<{
  /** `base` or `compare`: drawn above the card, and never abbreviated to an arrow. */
  label: string;
}>();

const repo = useRepoStore();
const settings = useSettingsStore();

// ── The card ────────────────────────────────────────────────────────────────

const summary = ref<CommitSummary | null>(null);
const loading = ref(false);

/** The two endpoints that are not commits have no metadata to show, and say so. */
const endpoint = computed(() => model.value.endpoint);

const artificial = computed(() =>
{
  if (endpoint.value.kind === ENDPOINT_KIND_WORKING_TREE)
  {
    return { title: 'Working tree', detail: 'uncommitted changes' };
  }
  if (endpoint.value.kind === ENDPOINT_KIND_INDEX)
  {
    return { title: 'Index', detail: 'staged changes' };
  }
  return null;
});

/**
 * True when `name` is not a real ref git resolved to `found`, only a prefix of its SHA:
 * so drawing it as a ref would be wrong.
 */
function isBareShaAlias(found: CommitSummary | null, name: string | null): boolean
{
  return !!found && !!name && found.sha.toLowerCase().startsWith(name.toLowerCase());
}

/** Drops a description a later endpoint change has already superseded. */
const resolving = newestOnly();

async function describe(): Promise<void>
{
  const path = repo.repo?.path;
  const current = endpoint.value;
  if (!path || current.kind !== ENDPOINT_KIND_COMMIT)
  {
    summary.value = null;
    return;
  }
  loading.value = true;
  // Endpoint can change before describe() returns; superseded result must not update the model.
  const newest = resolving.begin();
  try
  {
    const found = await api['revisions:describe'](path, current.sha);
    if (!newest())
    {
      return;
    }
    summary.value = found;

    // Bare SHA should not draw as a ref (40-char hex in ref color beside its short form is confusing).
    const name = model.value.name;
    if (isBareShaAlias(found, name))
    {
      model.value = { ...model.value, name: null };
    }
  }
  finally
  {
    // Only newest clears the loading flag; superseded requests must not.
    if (newest())
    {
      loading.value = false;
    }
  }
}

watch(model, () => void describe(), { immediate: true, deep: true });

// ── The picker ──────────────────────────────────────────────────────────────

const open = ref(false);
const picker = ref<InstanceType<typeof RevisionPicker> | null>(null);

/**
 * Convert a picked row to an endpoint. Caller asks for working/index rows (not the picker, compare-specific).
 */
function endpointFor(choice: RevisionChoice): DiffEndpoint
{
  if (choice.kind === ENDPOINT_KIND_WORKING_TREE)
  {
    return { kind: ENDPOINT_KIND_WORKING_TREE };
  }
  if (choice.kind === ENDPOINT_KIND_INDEX)
  {
    return { kind: ENDPOINT_KIND_INDEX };
  }
  return { kind: ENDPOINT_KIND_COMMIT, sha: choice.sha ?? '' };
}

function choose(choice: RevisionChoice): void
{
  model.value = { endpoint: endpointFor(choice), name: choice.ref ?? null };
  close();
}

function toggle(): void
{
  open.value = !open.value;
  // Focused rather than merely rendered: the picker is a filter box, and one you have to
  // click before you can type into is a dropdown with extra steps.
  if (open.value)
  {
    void nextTick(() => picker.value?.focus());
  }
}

function close(): void
{
  open.value = false;
}

const dateFormat = computed(() => settings.settings.dateFormat);
</script>

<template>
  <div class="slot-wrap">
    <span class="slot-label">{{ props.label }}</span>

    <button
      class="card"
      type="button"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="idline">
        <template v-if="artificial">
          <span class="name">{{ artificial.title }}</span>
        </template>
        <template v-else>
          <span v-if="model.name" class="name ref">{{ model.name }}</span>
          <span class="sha">{{
            endpoint.kind === ENDPOINT_KIND_COMMIT ? shortSha(summary?.sha ?? endpoint.sha) : ''
          }}</span>
        </template>
        <span class="caret" aria-hidden="true">▾</span>
      </span>

      <span v-if="artificial" class="subj muted">{{ artificial.detail }}</span>
      <template v-else-if="summary">
        <span class="subj truncate">{{ summary.subject }}</span>
        <span class="meta">
          {{ summary.authorName }} · {{ formatCommitDate(summary.authorDate, dateFormat) }}
        </span>
      </template>
      <template v-else>
        <span class="subj muted">{{ loading ? 'Reading…' : 'No such revision' }}</span>
        <span class="meta">&nbsp;</span>
      </template>
    </button>

    <!-- Scrim for click-away: otherwise the menu reads as stuck. -->
    <div v-if="open" class="scrim" @click="close" />

    <div v-if="open" class="picker" role="listbox" @keydown.esc.stop="close">
      <RevisionPicker ref="picker" include-working @choose="choose" />
    </div>
  </div>
</template>

<style scoped>
.slot-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slot-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-subtle);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: stretch;
  text-align: left;
  width: 100%;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.card:hover {
  border-color: var(--fg-subtle);
}

.idline {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.name {
  color: var(--fg);
  font-weight: 600;
}

.name.ref {
  color: var(--ref-branch);
}

.sha {
  color: var(--fg-muted);
}

.caret {
  margin-left: auto;
  color: var(--fg-subtle);
  font-size: 9px;
}

.subj {
  color: var(--fg);
}

.meta,
.muted {
  color: var(--fg-subtle);
  font-size: var(--text-xs);
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.picker {
  position: absolute;
  z-index: 11;
  top: 100%;
  left: 0;
  width: 100%;
  min-width: 240px;
  margin-top: 2px;
  padding: var(--space-1);
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}
</style>
