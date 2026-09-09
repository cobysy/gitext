<script setup lang="ts">
/**
 * View a patch file without applying it. No git, no reformatting (show raw bytes).
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { parsePatch, type PatchFile } from '@renderer/model/patch.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useReadOnlyEditor } from '@renderer/components/diff/useReadOnlyEditor.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormPathText from '@renderer/components/ui/FormPathText.vue';

const props = withDefaults(defineProps<{ filePath?: string }>(), {
  filePath: ''
});
const emit = defineEmits<{ close: [] }>();

const settings = useSettingsStore();
const { busy, error, perform } = useDialog();

const path = ref(props.filePath);

/** The file's whole text, as read. Empty until one is chosen. */
const text = ref('');
const truncated = ref(false);
const binary = ref(false);

const files = computed<PatchFile[]>(() => parsePatch(text.value));
const selectedIndex = ref(0);

const selected = computed(() => files.value[selectedIndex.value] ?? null);

/** Every line of the file, split once rather than per selection. */
const lines = computed(() => text.value.split('\n'));

/**
 * Selected file's section verbatim (startLine to next startLine, or EOF).
 */
const section = computed(() =>
{
  const file = selected.value;
  if (!file)
  {
    return '';
  }
  const next = files.value[selectedIndex.value + 1];
  return lines.value
    .slice(file.startLine, next?.startLine ?? lines.value.length)
    .join('\n');
});

/**
 * Whether this entry is `format-patch`'s mail preamble rather than a file.
 *
 * Such a patch opens with `From <sha>`, a Subject, the commit message and a diffstat,
 * all before the first `diff --git`. `parsePatch` keeps it as an entry with no paths and
 * no hunks. That entry holds the commit message, so it is the most useful section in the
 * file, but unlabelled it reads as a bug.
 */
function isPreamble(file: PatchFile): boolean
{
  return !file.oldPath && !file.newPath && file.hunks.length === 0;
}

/** The `Subject:` line of a mail-formatted patch, minus git's `[PATCH n/m]` marker. */
function subjectOf(file: PatchFile): string | null
{
  const line = file.header.find((entry) => entry.startsWith('Subject: '));
  if (line)
  {
    return line.slice(9).replace(/^\[PATCH[^\]]*\]\s*/, '');
  }
  else
  {
    return null;
  }
}

function nameOf(file: PatchFile): string
{
  if (isPreamble(file))
  {
    return subjectOf(file) ?? 'Commit message';
  }
  // A deletion has no new path, an addition no old one. Either way, take whichever end
  // exists.
  return file.newPath || file.oldPath || '(unnamed)';
}

function detailOf(file: PatchFile): string
{
  if (isPreamble(file))
  {
    return 'message and diffstat';
  }
  if (file.isBinary)
  {
    return 'binary';
  }
  if (file.isSubmodule)
  {
    return 'submodule';
  }
  if (!file.oldPath)
  {
    return 'added';
  }
  if (!file.newPath)
  {
    return 'deleted';
  }
  if (file.oldPath !== file.newPath)
  {
    return `renamed from ${file.oldPath}`;
  }
  const changed = file.hunks.reduce(
    (count, hunk) => count + hunk.lines.length,
    0
  );
  let hunkNoun: string;
  if (file.hunks.length === 1)
  {
    hunkNoun = 'hunk';
  }
  else
  {
    hunkNoun = 'hunks';
  }
  return `${file.hunks.length} ${hunkNoun} · ${changed} lines`;
}

const host = ref<HTMLElement | null>(null);

const content = computed(() =>
{
  if (section.value)
  {
    return { text: section.value, language: 'diff' };
  }
  else
  {
    return null;
  }
}
);

useReadOnlyEditor({
  host,
  effectiveTheme: () => settings.effectiveTheme,
  content: () => content.value,
  uriTag: 'patch-view'
});

async function read(): Promise<void>
{
  if (!path.value.trim())
  {
    return;
  }
  await perform(
    'Reading the patch',
    async () =>
    {
      const contents = await api['file:readPatch'](path.value.trim());
      text.value = contents.text;
      truncated.value = contents.truncated;
      binary.value = contents.binary;
      selectedIndex.value = 0;
    },
    // Reads a file and touches no repository. Nothing to refresh, and no reason to close:
    // the window *is* the answer.
    { close: false, refresh: false }
  );
}

async function choose(): Promise<void>
{
  await perform(
    'Choosing a patch',
    async () =>
    {
      // `'file'`, not a directory: a directory of patches has no contents to show. The
      // one way this differs from the apply dialog's picker.
      const chosen = await api['file:choosePatch']('', 'file');
      if (chosen)
      {
        path.value = chosen;
      }
    },
    { close: false, refresh: false }
  );
  await read();
}

// Opened with a path already, from a caller that had one, reads it without being asked.
watch(
  () => props.filePath,
  (next) =>
  {
    if (next)
    {
      path.value = next;
      void read();
    }
  },
  { immediate: true }
);

const empty = computed(
  () => !busy.value && path.value.trim() !== '' && files.value.length === 0
);
</script>

<template>
  <DialogFrame title="View Patch File" fixed-height @close="emit('close')">
    <div class="page">
      <!--
      The path spans the window rather than sitting in the list column, where it was 300px
      wide and showed the last twelve characters of an absolute path, which is the half
      that says least. A file chooser's whole output is a long string; it needs the width.
    -->
      <FormPathText
        v-model="path"
        label="Patch file"
        placeholder="Choose a .patch or .diff file"
        browse-label="Choose a patch file…"
        @browse="choose"
      />

      <div class="split">
        <div class="side-column">
          <ul class="list side">
            <li v-if="binary" class="placeholder error">
              That file is binary: it is not a patch.
            </li>
            <li v-else-if="empty" class="placeholder">
              No diffs in this file. It may not be a patch.
            </li>
            <li v-else-if="files.length === 0" class="placeholder">
              Choose a patch file to read it.
            </li>
            <li
              v-for="(file, index) in files"
              v-else
              :key="`${file.startLine}-${nameOf(file)}`"
            >
              <button
                class="entry"
                :class="{ current: index === selectedIndex }"
                @click="selectedIndex = index"
              >
                <span class="title truncate">{{ nameOf(file) }}</span>
                <span class="detail truncate">{{ detailOf(file) }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div class="detail-pane dense">
          <p v-if="truncated" class="warn">
            Only the first 2 MB of this file is shown.
          </p>
          <div ref="host" class="monaco" :class="{ blank: !content }" />
          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </div>
    </div>

    <template #actions>
      <button @click="emit('close')">Close</button>
      <!--
        Primary, and it is what makes a *typed* path work at all. Browse reads the file it
        picked, so without this the text box was decorative: you could type a path into it
        and nothing would ever open it. It also gives `useDialogKeyboard` something to press:
        that composable finds `.actions button.primary` rather than taking an event, so a
        dialog with no primary button is a dialog where Enter does nothing.
      -->
      <button class="primary" :disabled="!path.trim() || busy" @click="read">
        {{ busy ? "Reading…" : "Open" }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/monacoHost.css"></style>
<style scoped src="@renderer/styles/splitDialog.css"></style>

<style scoped>
/*
 * `.body` is a plain block with `overflow-y: auto`. Two stacked children do not share its
 * height on their own. This is the column that makes the list and the pane fill what the
 * path row leaves.
 */
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.split {
  /* Takes what the path row above it leaves, rather than the whole body. */
  height: auto;
  flex: 1;
  margin-top: var(--space-2);
}

.side-column {
  width: 300px;
}

/* Mounted always, hidden by opacity: `useReadOnlyEditor` builds its editor in
   `onMounted`, and an element behind a `v-if` never gets one. */
.monaco {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

</style>
