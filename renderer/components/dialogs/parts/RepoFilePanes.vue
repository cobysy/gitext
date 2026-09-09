<script setup lang="ts">
/**
 * The app's own file list beside the app's own viewer, embedded in a dialog: the pair
 * that answers "what is in this, and what does the one I picked look like". Three
 * windows draw it (comparing two revisions, reading a stash, reading a lost object) and
 * all three had written out the same two boxes, at three column widths and two border
 * colours, which is drift rather than three decisions.
 *
 * Which viewer is the pane's own switch, not the caller's: `filesPaneMode` says whether
 * the list is what changed or what the revision contains, and the viewer has to agree
 * with it. A caller that computed this for itself was computing the same thing under a
 * name (`isTree_`) that had to dodge its own `isTree`.
 *
 * It takes the height it is given and draws its own box, which is what two of the three
 * windows want. The third is `fixedHeight` with a form under the pair, so it sets a
 * height instead: a caller styles this component's root from its own scoped block, the
 * way it would any element.
 *
 * Monaco is the largest dependency here by an order of magnitude, so both viewers load
 * off the critical path: a window that never shows one never pays for it.
 */

import { computed, defineAsyncComponent } from 'vue';
import ChangedFiles from '@renderer/components/filelist/ChangedFiles.vue';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';

const DiffViewer = defineAsyncComponent(
  () => import('@renderer/components/diff/DiffViewer.vue')
);
const BlobViewer = defineAsyncComponent(
  () => import('@renderer/components/diff/BlobViewer.vue')
);

const settings = useSettingsStore();

/** The whole file, not a diff of it: what the tree mode is for. */
const showsWholeFile = computed(
  () => settings.settings.filesPaneMode === FILES_PANE_MODE_TREE
);
</script>

<template>
  <div class="panes">
    <div class="files">
      <ChangedFiles />
    </div>
    <BlobViewer v-if="showsWholeFile" />
    <DiffViewer v-else />
  </div>
</template>

<style scoped>
.panes {
  display: flex;
  flex: 1;
  /* So the two columns shrink to the height they are given rather than to their content. */
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  /* The box's corners cut the panes inside it, which have square ones of their own. */
  overflow: hidden;
}

/* Fixed, so the viewer takes every pixel the window gains: a path is read from its end,
   and the list has `.truncate` for the rest. */
.files {
  flex: none;
  width: 300px;
  min-width: 0;
  display: flex;
  border-right: 1px solid var(--border);
}
</style>
