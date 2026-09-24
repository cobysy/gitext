<script setup lang="ts">
/**
 * The repository window's blame: the file the list is on, at the revision the pane is
 * of, with who wrote each line beside it. The third answer to the pane's question,
 * drawn like the other two: the same header bar, the same switch, in the same place.
 *
 * It is the tree's default because a tree row is usually a file the selected commit
 * never touched, where the diff has nothing to say and the file alone says nothing
 * about the revision either.
 *
 * A gutter row is a way back into the history: clicking one selects the commit that
 * wrote the line, so reading a file leads to the commit behind any line of it.
 */

import { computed } from 'vue';
import { useRevealCommit } from '@renderer/composables/useRevealCommit.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import BlamePane from '@renderer/components/diff/BlamePane.vue';
import FilePaneSwitch from '@renderer/components/diff/FilePaneSwitch.vue';

const tree = useFileTreeStore();
const diff = useDiffStore();
const settings = useSettingsStore();
const { reveal } = useRevealCommit();

/** The path from whichever list the pane is beside, the same rule `BlobViewer` follows. */
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
});

/** Nothing at this end to blame: the commit took the file away. */
const deletedHere = computed(() => path.value !== null && tree.contentEntry === null);

/** Not text: `BlamePane` says so, and there are no lines or commits to count here. */
const binary = computed(() => tree.blame?.binary === true);

const lineCount = computed(() => tree.blame?.lines.length ?? 0);

/** How many commits the lines came from: what the gutter is worth reading for. */
const commitCount = computed(() => Object.keys(tree.blame?.commits ?? {}).length);

/** There is something to hand the pane, even when that something is "not text". */
const hasBlame = computed(() => tree.blame !== null);

function onPick(sha: string): void
{
  reveal(sha, { missing: 'That commit is not in the history this window has loaded.' });
}
</script>

<template>
  <section class="blame">
    <header class="bar">
      <span class="path truncate" :title="path ?? ''">{{ path ?? '' }}</span>
      <span class="spacer" />
      <span v-if="lineCount > 0" class="count">
        {{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }}
      </span>
      <span v-if="commitCount > 0" class="count">
        {{ commitCount }} {{ commitCount === 1 ? 'commit' : 'commits' }}
      </span>

      <FilePaneSwitch />
    </header>

    <p v-if="tree.blameError" class="placeholder error">{{ tree.blameError }}</p>
    <p v-else-if="deletedHere" class="placeholder">
      <code>{{ path }}</code> was deleted by this commit, so there are no lines here to
      attribute. Its contents are in the diff.
    </p>
    <p v-else-if="!path" class="placeholder">Select a file to see who wrote it.</p>
    <p v-else-if="tree.blameLoading && !tree.blame" class="placeholder">Reading…</p>
    <p v-else-if="tree.blame && !binary && lineCount === 0" class="placeholder">
      This file is empty.
    </p>

    <BlamePane
      v-show="hasBlame"
      :blame="tree.blame"
      :path="path ?? ''"
      uri-tag="blame"
      @pick="onPick"
    />
  </section>
</template>

<style scoped src="@renderer/styles/paneBar.css"></style>
<style scoped>
.blame {
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
</style>
