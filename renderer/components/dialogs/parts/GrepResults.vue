<script setup lang="ts">
/**
 * Search results: rows are buttons so Enter opens hit (not re-runs search).
 * Grouping and highlight are pure functions; this component only draws.
 */

import { computed } from 'vue';
import type { GrepHit } from '@shared/grep.js';
import { groupHits, splitMatches, type MatchOptions } from '@renderer/model/grepResults.js';

const props = defineProps<{
  hits: readonly GrepHit[];
  /** The literal to draw as matched, when the search was one whose span is provable. */
  term: string | null;
  matching: MatchOptions;
  /** Whether git ran at all yet: an empty list means two different things otherwise. */
  searched: boolean;
  /** The cap was reached and matches were left unread. */
  truncated: boolean;
}>();

const emit = defineEmits<{ open: [hit: GrepHit] }>();

const groups = computed(() => groupHits(props.hits));

function runs(text: string)
{
  return splitMatches(text, props.term, props.matching);
}
</script>

<template>
  <div class="results">
    <p v-if="!props.searched" class="placeholder">
      Type what to look for and press Find. Tracked files only.
    </p>
    <p v-else-if="groups.length === 0" class="placeholder">No file matches.</p>

    <template v-else>
      <div v-for="group in groups" :key="group.path" class="file">
        <div class="file-head">
          <span class="path truncate" :title="group.path">{{ group.path }}</span>
          <span class="count">{{ group.hits.length }}</span>
        </div>

        <button
          v-for="hit in group.hits"
          :key="`${hit.path}:${hit.line}`"
          class="row"
          type="button"
          @click="emit('open', hit)"
        >
          <span class="line">{{ hit.line }}</span>
          <span class="text truncate">
            <template v-for="(run, index) in runs(hit.text)" :key="index"
              ><mark v-if="run.match">{{ run.text }}</mark
              ><template v-else>{{ run.text }}</template></template
            >
          </span>
        </button>
      </div>

      <p v-if="props.truncated" class="warn">
        Stopped after the first {{ props.hits.length }} matches. Narrow the search: a
        pattern with more in it, or a path to look under.
      </p>
    </template>
  </div>
</template>

<style scoped src="@renderer/styles/listRow.css"></style>

<style scoped>
.results {
  height: 100%;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.placeholder,
.warn {
  margin: 0;
  padding: var(--space-3);
}

/* Sticky, because the whole point of grouping is knowing which file you are reading,
   and a file with forty matches otherwise scrolls its own name away first. */
.file-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.file + .file .file-head {
  border-top: 1px solid var(--border-subtle);
}

.path {
  color: var(--fg);
  font-weight: 600;
}

.count {
  margin-left: auto;
  color: var(--fg-subtle);
  font-size: var(--text-xs);
}

.row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  padding: 1px var(--space-2);
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg);
}

/* Right-aligned in a fixed column, so the code beside them starts at one place rather
   than stepping right as the line numbers get longer. */
.line {
  flex: none;
  width: 4.5ch;
  text-align: right;
  color: var(--fg-subtle);
}

.text {
  min-width: 0;
  /* A matched line is code: the shape of the indentation is half of what makes it
     recognisable, so runs of spaces are kept and the row scrolls rather than wraps. */
  white-space: pre;
}

mark {
  background: var(--bg-match);
  color: inherit;
  border-radius: 2px;
}
</style>
