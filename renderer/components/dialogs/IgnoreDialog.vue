<script setup lang="ts">
/**
 * Ignore file: choose .gitignore or .git/info/exclude. No git argv (file append),
 * so preview shows result. Duplicates are not written twice.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import {
  IGNORE_STYLE_CUSTOM,
  IGNORE_STYLES,
  ignorePatternsFor,
  newRules,
  type IgnoreStyle
} from '@renderer/model/ignorePatterns.js';
import type { IgnoreTarget } from '@shared/types.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';

const props = withDefaults(
  defineProps<{
    /** Paths the menu was opened over. */
    filePaths?: readonly string[];
    /** Which file: gitignore or exclude. */
    target?: IgnoreTarget;
  }>(),
  { filePaths: () => [], target: 'gitignore' }
);

const emit = defineEmits<{ close: [] }>();

const IGNORE_TARGET_GITIGNORE = 'gitignore';

const repo = useRepoStore();
const { busy, error, perform } = useDialog();

const target = ref<IgnoreTarget>(props.target);
const style = ref<IgnoreStyle>('path');
const custom = ref('');
/** Current contents of the target file. */
const contents = ref('');

const TARGETS: readonly RadioOption[] = [
  {
    value: 'gitignore',
    label: '`.gitignore`, for everyone',
    hint: 'Committed, applies to everyone who clones.'
  },
  {
    value: 'exclude',
    label: '`.git/info/exclude`, for this clone only',
    hint: 'Never committed, yours alone.'
  }
];

const styleOptions = computed<readonly RadioOption[]>(() =>
  IGNORE_STYLES.map((entry) =>
  {
    const produced = ignorePatternsFor(entry.style, props.filePaths);
    // Show the pattern in hint: user needs to see what will be written.
    let hint: string;
    if (entry.style === IGNORE_STYLE_CUSTOM)
    {
      hint = entry.detail;
    }
    else if (produced.length)
    {
      // Patterns as tokens with middot separator, matching what gets written.
      hint = `${produced.map((pattern) => `\`${pattern}\``).join(' · ')}: ${entry.detail}`;
    }
    else
    {
      let subject: string;
      if (props.filePaths.length === 1)
      {
        subject = 'this file';
      }
      else
      {
        subject = 'these files';
      }
      hint = `Not available for ${subject}.`;
    }
    return {
      value: entry.style,
      label: entry.label,
      hint,
      disabled: entry.style !== IGNORE_STYLE_CUSTOM && produced.length === 0
    };
  })
);

/** Requested lines before duplicate filtering. */
const wanted = computed(() =>
{
  if (style.value === IGNORE_STYLE_CUSTOM)
  {
    return custom.value.split('\n');
  }
  else
  {
    return ignorePatternsFor(style.value, props.filePaths);
  }
}
);

/** Requested lines after filtering duplicates. */
const additions = computed(() => newRules(contents.value, wanted.value));

/** Patterns already in file (not added again). */
const alreadyThere = computed(() =>
{
  const adding = new Set(additions.value);
  return wanted.value
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0 && !adding.has(rule));
});

/** Last 6 lines of file for preview context. */
const tail = computed(() =>
{
  const existing = contents.value.split('\n').filter((line, index, all) =>
    // Drop trailing newline's empty line, not blank lines within.
    !(index === all.length - 1 && line === '')
  );
  return existing.slice(-6);
});

const fileName = computed(() =>
{
  if (target.value === IGNORE_TARGET_GITIGNORE)
  {
    return '.gitignore';
  }
  else
  {
    return '.git/info/exclude';
  }
}
);

watch(
  [target, () => repo.repo?.path],
  async () =>
  {
    const path = repo.repo?.path;
    if (path)
    {
      contents.value = await api['file:ignoreRules'](path, target.value);
    }
    else
    {
      contents.value = '';
    }
  },
  { immediate: true }
);

async function addRules(): Promise<void>
{
  const rules = additions.value;
  if (rules.length === 0)
  {
    return;
  }
  await perform(`Writing ${fileName.value}`, async (repoPath) =>
  {
    await api['file:addIgnoreRules'](repoPath, target.value, rules);
  });
}
</script>

<template>
  <DialogFrame title="Ignore Files" @close="emit('close')">
    <div class="form">
      <p v-if="props.filePaths.length" class="hint">
        {{ props.filePaths.length === 1 ? props.filePaths[0] : `${props.filePaths.length} files` }}
      </p>

      <FormGroup label="Where the rule goes">
        <FormRadioGroup v-model="target" :options="TARGETS" />
      </FormGroup>

      <FormGroup label="What to ignore">
        <FormRadioGroup v-model="style" :options="styleOptions" />
        <FormTextArea
          v-if="style === IGNORE_STYLE_CUSTOM"
          v-model="custom"
          :rows="3"
          monospace
          placeholder="One pattern per line"
        />
      </FormGroup>

      <!-- File contents preview: tail + new lines. -->
      <FormGroup :label="`${fileName} will end`">
        <pre class="result selectable"><span v-for="(line, index) in tail" :key="`old-${index}`" class="line">{{ line || ' ' }}
</span><span v-for="rule in additions" :key="`new-${rule}`" class="line added">{{ rule }}
</span><span v-if="!tail.length && !additions.length" class="placeholder">Nothing yet.</span></pre>
      </FormGroup>

      <p v-if="alreadyThere.length" class="hint">
        Already ignored here: {{ alreadyThere.join(', ') }}.
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!additions.length || busy" @click="addRules">
        {{ busy ? 'Writing…' : `Add to ${fileName}` }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* Monospace: rules are read character-by-character. */
.result {
  margin: 0;
  padding: var(--space-2);
  max-height: 160px;
  overflow: auto;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

/* New rules being added. */
.added {
  color: var(--success);
  font-weight: 600;
}
</style>
