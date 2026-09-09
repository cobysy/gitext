<script setup lang="ts">
/**
 * Single file at revision in tree. No diff (no markers/hunks/tint).
 * Monaco: syntax highlighting, find/go-to-line, windowing for large files.
 */

import { computed, ref } from 'vue';
import {
  useReadOnlyEditor,
  type ReadOnlyEditorContent
} from '@renderer/components/diff/useReadOnlyEditor.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommandContext.js';
import { filePaneViewMenu } from '@renderer/menus/fileList.js';
import { resolveMenu, resolvedCommands } from '@renderer/menus/resolve.js';
import SegmentedSwitch from '@renderer/components/ui/SegmentedSwitch.vue';
import Glyph from '@renderer/components/ui/Glyph.vue';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFilePaneStore } from '@renderer/stores/filePane.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { languageForPath } from '@renderer/monacoLang.js';
import { formatBytes } from '@renderer/format.js';
import { isBlobShowable } from '@renderer/model/blob.js';

const tree = useFileTreeStore();
const diff = useDiffStore();
const filePane = useFilePaneStore();
const settings = useSettingsStore();
const commandContext = useCommandContext();

const COMMAND_ID_VIEW_DIFF = 'files.viewDiff';

/** Diff or whole file switch. */
const viewItems = computed(() =>
  resolvedCommands(resolveMenu(filePaneViewMenu, commandContext.value))
);

function onMenuCommand(id: string): void
{
  void runCommand(id, commandContext.value);
}

/**
 * Path from tree selection or changed list. Latter case: pane couldn't
 * open before two switches separated.
 */
const path = computed(() =>
{
  if (settings.settings.filesPaneMode === FILES_PANE_MODE_TREE)
  {
    return tree.selectedPath;
  }
  else
  {
    return diff.selectedPath;
  }
}
);

/**
 * Deleted file has no contents at this end. Diff still has it.
 */
const deletedHere = computed(
  () => filePane.wantedPath !== null && path.value !== null && tree.contentEntry === null
);

// ── The pane ─────────────────────────────────────────────────────────────────

const container = ref<HTMLElement | null>(null);

/**
 * What the pane is showing: the blob's text under the path's own language, or nothing
 * at all when the file is one Monaco should not be handed (binary, or too large).
 */
const content = computed<ReadOnlyEditorContent | null>(() =>
{
  const blob = tree.blob;
  if (!isBlobShowable(blob))
  {
    return null;
  }
  return { text: blob.text, language: languageForPath(path.value ?? '') };
});

useReadOnlyEditor({
  host: container,
  effectiveTheme: () => settings.effectiveTheme,
  content: () => content.value,
  uriTag: 'blob'
});

// ── Size info for the header ─────────────────────────────────────────────────

const lineCount = computed(() =>
{
  const text = tree.blob?.text;
  if (!text)
  {
    return 0;
  }
  const n = text.split('\n').length;
  if (text.endsWith('\n'))
  {
    return n - 1;
  }
  else
  {
    return n;
  }
});
</script>

<template>
  <section class="blob">
    <header class="bar">
      <span class="path truncate" :title="path ?? ''">{{ path ?? '' }}</span>
      <span class="spacer" />
      <span v-if="lineCount > 0" class="count">
        {{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }}
      </span>
      <span v-if="tree.blob && tree.blob.size > 0" class="count">
        {{ formatBytes(tree.blob.size) }}
      </span>

      <SegmentedSwitch :items="viewItems" @run="onMenuCommand">
        <template #icon="{ id }">
          <!-- The same pair `DiffViewer` draws: the diff, and the file itself. -->
          <Glyph v-if="id === COMMAND_ID_VIEW_DIFF" name="diffFile" />
          <Glyph v-else name="textFile" />
        </template>
      </SegmentedSwitch>
    </header>

    <p v-if="tree.blobError" class="placeholder error">{{ tree.blobError }}</p>
    <p v-else-if="deletedHere" class="placeholder">
      <code>{{ path }}</code> was deleted by this commit, so there is nothing here to read.
      Its contents are in the diff.
    </p>
    <p v-else-if="tree.blobLoading && !tree.blob" class="placeholder">Loading…</p>
    <p v-else-if="!path" class="placeholder">Select a file to see its contents.</p>
    <p v-else-if="tree.blob?.missing" class="placeholder">
      <code>{{ path }}</code> is not in this revision.
    </p>
    <p v-else-if="tree.blob?.submodule" class="placeholder">
      A submodule, recorded here as one commit. Open it from the left panel to see inside.
    </p>
    <p v-else-if="tree.blob?.binary" class="placeholder">
      This is a binary file ({{ formatBytes(tree.blob.size) }}); there is nothing to show as text.
    </p>
    <p v-else-if="tree.blob && lineCount === 0" class="placeholder">This file is empty.</p>

    <div
      ref="container"
      class="monaco"
      :class="{ hidden: !tree.blob?.text }"
    />

    <p v-if="tree.blob?.truncated" class="placeholder truncated">
      This file is too large to show in full; what is above is the start of it.
    </p>
  </section>
</template>

<style scoped src="@renderer/styles/paneBar.css"></style>
<style scoped>
.blob {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}


.path {
  font-size: var(--text-xs);
  font-weight: 600;
}

.count {
  font-size: var(--text-xs);
  color: var(--fg-muted);
  flex: none;
  white-space: nowrap;
}

.monaco {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.monaco.hidden {
  display: none;
}


.placeholder.truncated {
  border-top: 1px solid var(--border-subtle);
  color: var(--warning);
  flex: none;
}
</style>
