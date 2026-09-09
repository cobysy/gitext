<script setup lang="ts">
/**
 * Archive a revision to a file. Destination in --output, filters as radio buttons (not checkboxes).
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { ENDPOINT_KIND_COMMIT } from '@shared/diff.js';
import { FILE_STATUS_DELETED } from '@shared/types.js';
import {
  ARCHIVE_FORMATS,
  buildArchiveArgs,
  suggestedArchiveName,
  type ArchiveFormat
} from '@renderer/model/args/archive.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormPathText from '@renderer/components/ui/FormPathText.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import CommitPicker from './parts/CommitPicker.vue';
import CommitSummary from './parts/CommitSummary.vue';
import { READS } from '@shared/invalidation.js';

const props = defineProps<{ sha: string }>();
const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const { busy, error, run, perform } = useDialog();

// Archive scope modes
const SCOPE_ALL = 'all';
const SCOPE_PATHS = 'paths';
const SCOPE_CHANGED = 'changed';

/** How much of the revision goes in. */
type Scope = 'all' | 'paths' | 'changed';

// Diff endpoint kind and file status

const DEFAULT_FORMAT = 'zip';
const DEFAULT_REPO_NAME = 'archive';

const revision = ref(props.sha);
const format = ref<ArchiveFormat>(DEFAULT_FORMAT);
const prefix = ref('');
const scope = ref<Scope>(SCOPE_ALL);
const paths = ref('');
/** The other end of "what changed", for the `changed` scope. */
const since = ref('');
const output = ref('');
/** The paths the `changed` scope resolved to, so the preview can show the real argv. */
const changedPaths = ref<string[]>([]);
const changedError = ref('');

const formatOptions: readonly RadioOption[] = ARCHIVE_FORMATS.map((entry) => ({
  value: entry.format,
  label: entry.label,
  hint: `--format=${entry.format}`
}));

const scopeOptions: readonly RadioOption[] = [
  { value: SCOPE_ALL, label: 'The whole revision', hint: 'Every file the commit contains.' },
  {
    value: SCOPE_PATHS,
    label: 'Only these paths',
    hint: 'One per line, they become the pathspec after the `--`.'
  },
  {
    value: SCOPE_CHANGED,
    label: 'Only what changed since another revision',
    hint: 'Passed as paths, `git archive` has no range.'
  }
];

const chosenPaths = computed<string[]>(() =>
{
  if (scope.value === SCOPE_PATHS)
  {
    return paths.value.split('\n');
  }
  if (scope.value === SCOPE_CHANGED)
  {
    return changedPaths.value;
  }
  return [];
});

const argv = computed(() =>
  buildArchiveArgs({
    revision: revision.value,
    format: format.value,
    output: output.value,
    prefix: prefix.value,
    paths: chosenPaths.value
  })
);

/** The repo path to diff, or null when the changed-paths watch has nothing to ask for yet. */
function changedPathsRepoOf(
  scope: Scope,
  since: string,
  revision: string,
  repoPath: string | undefined
): string | null
{
  if (scope === SCOPE_CHANGED && since.trim() && revision.trim() && repoPath)
  {
    return repoPath;
  }
  else
  {
    return null;
  }
}

/**
 * What changed between the two revisions, as a list of paths.
 *
 * `git archive` takes a tree and a pathspec and has no notion of a range, so "archive
 * what changed" can only be done by asking for the list and passing it. Deleted files are
 * dropped: they are not in the newer tree, and naming one makes git fail with "pathspec
 * did not match any files".
 */
watch([scope, since, revision], async () =>
{
  changedPaths.value = [];
  changedError.value = '';
  const path = changedPathsRepoOf(scope.value, since.value, revision.value, repo.repo?.path);
  if (!path)
  {
    return;
  }

  try
  {
    const files = await api['diff:files'](
      path,
      {
        from: { kind: ENDPOINT_KIND_COMMIT, sha: since.value.trim() },
        to: { kind: ENDPOINT_KIND_COMMIT, sha: revision.value.trim() }
      },
      {}
    );
    changedPaths.value = files
      .filter((file) => file.status !== FILE_STATUS_DELETED)
      .map((file) => file.path);
    if (changedPaths.value.length === 0)
    {
      changedError.value = 'Nothing changed between those two revisions.';
    }
  }
  catch
  {
    changedError.value = `${since.value.trim()} does not resolve to a revision.`;
  }
});

/** Keep the suggested filename in step with the format until somewhere is chosen. */
const repoName = computed(() => repo.repo?.name ?? DEFAULT_REPO_NAME);

async function chooseFile(): Promise<void>
{
  const entry = ARCHIVE_FORMATS.find((info) => info.format === format.value);
  await perform(
    'Choosing where to save',
    async () =>
    {
      let extensions: string[];
      if (entry)
      {
        extensions = [entry.extension];
      }
      else
      {
        extensions = [];
      }
      const chosen = await api['file:chooseSavePath'](
        suggestedArchiveName(repoName.value, revision.value, format.value, chosenPaths.value),
        extensions
      );
      if (chosen)
      {
        output.value = chosen;
      }
    },
    { close: false, refresh: false }
  );
}

/**
 * Nothing in the repository changed, so nothing is refreshed, but the window closes,
 * because the file either exists now or git said why it does not.
 */
async function save(): Promise<void>
{
  // The archive is written outside the repository; nothing in it moved.
  await run(argv.value, READS, { refresh: false });
}
</script>

<template>
  <DialogFrame title="Archive Revision" @close="emit('close')">
    <div class="form">
      <CommitPicker v-model="revision" label="Archive" summary-label="Which is" />

      <FormGroup label="Format">
        <FormRadioGroup v-model="format" :options="formatOptions" inline />
      </FormGroup>

      <FormGroup label="How much of it">
        <FormRadioGroup v-model="scope" :options="scopeOptions" />

        <FormTextArea
          v-if="scope === SCOPE_PATHS"
          v-model="paths"
          :rows="3"
          monospace
          placeholder="src&#10;docs/guide.md"
        />

        <template v-if="scope === SCOPE_CHANGED">
          <FormText v-model="since" label="Changed since" placeholder="HEAD~1, a tag, a SHA" />
          <CommitSummary :rev="since" label="Which is" />
          <p v-if="changedError" class="warn">{{ changedError }}</p>
          <p v-else-if="changedPaths.length" class="hint">
            {{ changedPaths.length }}
            {{ changedPaths.length === 1 ? 'file' : 'files' }}, passed as the pathspec below.
          </p>
        </template>
      </FormGroup>

      <FormText
        v-model="prefix"
        label="Inside a folder"
        placeholder="Optional: everything is nested under this name"
        hint="`--prefix`: a folder inside the archive."
      />

      <FormPathText
        v-model="output"
        label="Save to"
        placeholder="The file to write: part of the command below"
        browse-label="Choose a file…"
        :disabled="busy"
        @browse="chooseFile"
      />

      <CommandPreview :argv="argv" />
      <p v-if="!output" class="hint">
        The destination is part of the command.
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="save">
        {{ busy ? 'Writing…' : 'Create Archive' }}
      </button>
    </template>
  </DialogFrame>
</template>
