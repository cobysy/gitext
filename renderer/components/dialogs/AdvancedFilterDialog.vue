<script setup lang="ts">
/**
 * Advanced Filter: session-scoped query shape (not a git operation; Apply sends options to repo window).
 * What belongs here: session-scoped options, not preferences (those stay in Settings).
 */

import { computed, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildLogFilterArgs } from '@renderer/model/args/logFilter.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import type { LogOptions } from '@shared/types.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const props = withDefaults(
  defineProps<{
    /** The repository window's current session filter: see `DialogPayload.logFilter`. */
    logFilter?: LogOptions;
  }>(),
  { logFilter: () => ({}) }
);

const emit = defineEmits<{ close: [] }>();

const { busy, error, perform } = useDialog();

const authorFilter = ref(props.logFilter.authorFilter ?? '');
const committerFilter = ref(props.logFilter.committerFilter ?? '');
const messageFilter = ref(props.logFilter.messageFilter ?? '');
const diffContentFilter = ref(props.logFilter.diffContentFilter ?? '');
const since = ref(props.logFilter.since ?? '');
const until = ref(props.logFilter.until ?? '');
const useRegex = ref(props.logFilter.useRegex ?? false);
const ignoreCase = ref(props.logFilter.ignoreCase ?? false);
const hideMergeCommits = ref(props.logFilter.hideMergeCommits ?? false);
const firstParentOnly = ref(props.logFilter.firstParentOnly ?? false);

/** Empty means unset: same convention `LogOptions` itself uses for every text filter. */
function orUndefined(text: string): string | undefined
{
  const trimmed = text.trim();
  if (trimmed === '')
  {
    return undefined;
  }
  else
  {
    return trimmed;
  }
}

const draft = computed<LogOptions>(() => ({
  authorFilter: orUndefined(authorFilter.value),
  committerFilter: orUndefined(committerFilter.value),
  messageFilter: orUndefined(messageFilter.value),
  diffContentFilter: orUndefined(diffContentFilter.value),
  since: orUndefined(since.value),
  until: orUndefined(until.value),
  useRegex: useRegex.value,
  ignoreCase: ignoreCase.value,
  hideMergeCommits: hideMergeCommits.value,
  firstParentOnly: firstParentOnly.value
}));

const previewArgv = computed(() => buildLogFilterArgs(draft.value));

const hasTextFilter = computed(
  () => Boolean(authorFilter.value.trim() || committerFilter.value.trim() || messageFilter.value.trim())
);

async function apply(): Promise<void>
{
  await perform('Applying the filter', async () => api['dialog:applyLogFilter'](draft.value), {
    refresh: false
  });
}
</script>

<template>
  <DialogFrame title="Advanced Filter" @close="emit('close')">
    <div class="form">
      <FormGroup label="Commits">
        <FormText v-model="authorFilter" label="Author" placeholder="name or email" />
        <FormText v-model="committerFilter" label="Committer" placeholder="name or email" />
        <FormText v-model="messageFilter" label="Message" placeholder="text or pattern" />
        <FormText
          v-model="diffContentFilter"
          label="Diff contains"
          placeholder="text added or removed"
          hint="`-S`: slow on a large history."
        />
        <FormCheck
          v-model="useRegex"
          label="Regular expressions"
          hint="Author, committer and message are matched as patterns."
          :disabled="!hasTextFilter"
        />
        <FormCheck v-model="ignoreCase" label="Ignore case" :disabled="!hasTextFilter" />
      </FormGroup>

      <FormGroup label="Date range">
        <FormText v-model="since" label="Since" placeholder="2024-01-01, or 2 weeks ago" />
        <FormText v-model="until" label="Until" placeholder="2024-12-31, or yesterday" />
      </FormGroup>

      <FormGroup label="History shape">
        <FormCheck
          v-model="hideMergeCommits"
          label="Hide merge commits"
          hint="`--no-merges`"
        />
        <FormCheck
          v-model="firstParentOnly"
          label="Follow only the first parent"
          hint="`--first-parent`: collapses merged branches out of the view."
        />
      </FormGroup>

      <CommandPreview :argv="previewArgv" placeholder="No filter set" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="busy" @click="apply">
        {{ busy ? 'Applying…' : 'Apply' }}
      </button>
    </template>
  </DialogFrame>
</template>
