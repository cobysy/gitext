<script setup lang="ts">
/**
 * Find in Files: `git grep` over the working tree, the index, or a commit, so it asks
 * where as well as what, and answers with matching lines rather than a narrowed file
 * list. Reads, so it's `perform(..., { close: false, refresh: false })` around a channel
 * of its own, not `run()`: nothing to refresh, no reason to close on success.
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import {
  GREP_MODES,
  buildGrepArgs,
  type GrepHit,
  type GrepMode,
  type GrepOptions
} from '@shared/grep.js';
import {
  ENDPOINT_KIND_INDEX,
  ENDPOINT_KIND_WORKING_TREE,
  rowShaOf,
  type DiffEndpoint
} from '@shared/diff.js';
import { flagsIn } from '@renderer/model/args/summary.js';
import { highlightTerm } from '@renderer/model/grepResults.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import GrepResults from '@renderer/components/dialogs/parts/GrepResults.vue';
import RevisionSlot from '@renderer/components/dialogs/parts/RevisionSlot.vue';
import type { SlotRevision } from '@renderer/components/dialogs/parts/slotRevision.js';

const props = defineProps<{
  /** Where to search, when a surface said: the commit that was right-clicked. Null is the working tree, what the menu-bar row means. */
  revision?: DiffEndpoint | null;
}>();

const emit = defineEmits<{ close: [] }>();


const { busy, error, perform, close } = useDialog();

const where = ref<SlotRevision>({
  endpoint: props.revision ?? { kind: 'workingTree' },
  name: null
});

const pattern = ref('');
const mode = ref<GrepMode>('fixed');
/** Unticked by default, so `-i` is on: git's own default is case-sensitive, but this is a search box, and the flag shows in the preview. */
const matchCase = ref(false);
const wholeWord = ref(false);
const pathText = ref('');

const results = ref<GrepHit[]>([]);
const truncated = ref(false);
/** What the results below are *of*: held so the list is not relabelled as you retype. */
const searched = ref<GrepOptions | null>(null);

const modeOptions = GREP_MODES.map((entry) => ({ value: entry.mode, label: entry.label }));
const modeHint = computed(
  () => GREP_MODES.find((entry) => entry.mode === mode.value)?.detail ?? ''
);

/** One pathspec per line, the same shape the clean dialog's two path boxes take. */
const paths = computed(() =>
  pathText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
);

const options = computed<GrepOptions>(() => ({
  pattern: pattern.value,
  mode: mode.value,
  ignoreCase: !matchCase.value,
  wholeWord: wholeWord.value,
  endpoint: where.value.endpoint,
  paths: paths.value
}));

const argv = computed(() =>
{
  if (pattern.value)
  {
    return buildGrepArgs(options.value);
  }
  else
  {
    return [];
  }
});

/** Built from the argv, minus what no control sets: the parseable-output flags, `-e` (the pattern box already shows it), and `--cached` (the endpoint card shows it). */
const summary = computed(() =>
  flagsIn(argv.value, ['--line-number', '-z', '-I', '-e', '--', '--cached'])
);

const term = computed(() =>
{
  if (searched.value)
  {
    return highlightTerm(searched.value.pattern, searched.value.mode);
  }
  else
  {
    return null;
  }
}
);
const matching = computed(() => ({
  ignoreCase: searched.value?.ignoreCase ?? true,
  wholeWord: searched.value?.wholeWord ?? false
}));

/** What the header says it searched: the card's own words for the endpoint. */
const scope = computed(() =>
{
  const endpoint = where.value.endpoint;
  if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
  {
    return 'the working tree';
  }
  if (endpoint.kind === ENDPOINT_KIND_INDEX)
  {
    return 'the index';
  }
  return where.value.name ?? endpoint.sha.slice(0, 8);
});

async function search(): Promise<void>
{
  if (!pattern.value)
  {
    return;
  }
  const asked = options.value;
  const ok = await perform(
    'Searching',
    async (repoPath) =>
    {
      const result = await api['search:grep'](repoPath, asked);
      results.value = [...result.hits];
      truncated.value = result.truncated;
    },
    { close: false, refresh: false }
  );
  // Only on success: a failed search leaves the previous results rather than an empty list that reads as "nothing matches".
  if (ok)
  {
    searched.value = asked;
  }
}

/**
 * Show this hit in the window that has a file pane. The row first, then the path, for
 * all three endpoints: asking for a path before moving there would open it at whatever
 * the grid's selection already showed. `rowShaOf` covers the working tree and index too via their sentinel SHAs.
 */
async function open(hit: GrepHit): Promise<void>
{
  await api['dialog:goToRevision'](rowShaOf(where.value.endpoint));
  await api['dialog:showInFileTree'](hit.path);
  close();
}
</script>

<template>
  <!-- `fixed-height`: the body is a results list of arbitrary length, so there's no content height to size the window to. -->
  <DialogFrame title="Find in Files" fixed-height @close="emit('close')">
    <div class="find">
      <div class="form">
        <FormText
          v-model="pattern"
          label="Find"
          placeholder="Text to look for in every tracked file"
          autofocus
        />

        <div class="where">
          <RevisionSlot v-model="where" label="search in" />
        </div>

        <FormDisclosure label="Search options" :summary="summary">
          <FormSelect v-model="mode" label="Pattern" :options="modeOptions" :hint="modeHint" />
          <FormCheck
            v-model="matchCase"
            label="Match case"
            hint="Off is `-i`."
          />
          <FormCheck
            v-model="wholeWord"
            label="Match whole word"
            hint="`-w`: the match may not sit inside a longer identifier."
          />
          <FormTextArea
            v-model="pathText"
            label="Only under"
            :rows="2"
            monospace
            placeholder="One pathspec per line: becomes -- <path>…"
          />
        </FormDisclosure>

        <CommandPreview :argv="argv" placeholder="Type what to look for." />
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div class="found">
        <div class="found-head">
          <span v-if="searched">
            {{ results.length }} {{ results.length === 1 ? 'match' : 'matches' }} in {{ scope }}
          </span>
          <span v-else class="hint">Nothing searched yet</span>
        </div>

        <GrepResults
          :hits="results"
          :term="term"
          :matching="matching"
          :searched="searched !== null"
          :truncated="truncated"
          @open="open"
        />
      </div>
    </div>

    <template #actions>
      <button @click="emit('close')">Close</button>
      <button class="primary" :disabled="!pattern || busy" @click="search">
        {{ busy ? 'Searching…' : 'Find' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* A `fixedHeight` window gives its body the room but nothing inside stretches by default; without this the results list would leave the bottom of the window empty. */
.find {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
}

.form {
  flex: none;
}

/* `.slot-wrap` is `flex: 1`, so it needs a flex parent to fill the row rather than sit at its content width. */
.where {
  display: flex;
}

.found {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-height: 0;
}

.found-head {
  flex: none;
  color: var(--fg-muted);
  font-size: var(--text-sm);
}
</style>
