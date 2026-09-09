/**
 * The tree at a revision, and the contents of the file being looked at. Sibling of
 * `stores/diff.ts`, deliberately shaped like it: the selection decides an endpoint, the
 * endpoint decides the listing, the listing decides which file is read. What it
 * doesn't share is the pivot: a tree has one end, not two. `range.to` is that end.
 *
 * - `fileTree/selection.ts`: the listing, and what is picked in it.
 * - `fileTree/listing.ts`: reading the listing for the current endpoint.
 * - `fileTree/blob.ts`: the followed file's contents.
 */

import { defineStore } from 'pinia';
import { computed, watch } from 'vue';
import { ENDPOINT_KIND_COMMIT, type DiffEndpoint } from '@shared/diff.js';
import type { TreeEntry } from '@shared/tree.js';
import { FILE_STATUS_DELETED } from '@shared/types.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFilePaneStore } from '@renderer/stores/filePane.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { FILE_PANE_VIEW_FILE, FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { createSelectionState } from './fileTree/selection.js';
import { createListingState } from './fileTree/listing.js';
import { createBlobState } from './fileTree/blob.js';

const TREE_ENTRY_KIND_BLOB = 'blob';
const FILE_MODE_DEFAULT = '100644';

export const useFileTreeStore = defineStore('fileTree', () =>
{
  const repo = useRepoStore();
  const diff = useDiffStore();
  const pane = useFilePaneStore();
  const settings = useSettingsStore();

  /**
   * The end of the diff pivot the tree is of. Derived from the diff store, not the
   * selection directly, so the two panes can't disagree about which revision is on screen.
   */
  const endpoint = computed<DiffEndpoint | null>(() => diff.range?.to ?? null);

  /**
   * The key that says which listing is loaded. `endpoint` is a fresh object on every
   * selection change, so watching it directly would re-read the tree on every keystroke, including ones landing back on the same commit.
   */
  const endpointKey = computed(() =>
  {
    const current = endpoint.value;
    if (!current)
    {
      return '';
    }
    if (current.kind === ENDPOINT_KIND_COMMIT)
    {
      return current.sha;
    }
    else
    {
      return current.kind;
    }
  });

  const selection = createSelectionState({ pane, settings });

  /** Everything else's state, for the "no repository open" branch of `load`. */
  function reset(): void
  {
    selection.reset();
    listing.reset();
    blob.reset();
  }

  const listing = createListingState({
    repo,
    endpoint: () => endpoint.value,
    endpointKey: () => endpointKey.value,
    selection,
    resetForNoRepo: reset
  });
  /**
   * Only load the listing while the pane is showing the tree: a whole-repository
   * listing isn't free (17k files is a subprocess and a structured clone), so paying
   * for it while nobody's looking would be waste.
   */
  const active = computed(() => settings.settings.filesPaneMode === FILES_PANE_MODE_TREE);

  /**
   * Whether anything is *looking* at a file's contents, different from whether the
   * tree is the list: either list can show contents now, so listing and blob are gated
   * separately, or showing contents beside the changed list would drag in a full listing.
   */
  const showingContents = computed(() => settings.settings.filePaneView === FILE_PANE_VIEW_FILE);

  /**
   * The file whose contents to read, from whichever list is being picked from. The
   * tree has real entries; the changed list has paths and a status, so an entry is made
   * up (`readBlob` reads `kind`/`mode` only to tell a gitlink from a file). Null when
   * the path has no contents *at this end*: a file the commit deleted isn't there to read.
   */
  const contentEntry = computed<TreeEntry | null>(() =>
  {
    if (active.value)
    {
      return selection.selectedEntry.value;
    }
    const file = diff.selectedFile;
    if (!file || file.status === FILE_STATUS_DELETED)
    {
      return null;
    }
    return { path: file.path, kind: TREE_ENTRY_KIND_BLOB, mode: FILE_MODE_DEFAULT };
  });

  const blob = createBlobState({
    repo,
    endpoint: () => endpoint.value,
    entry: () => contentEntry.value
  });

  // Below `blob`, not above: the first run reaches `reset()` when no repository is open
  // yet, and that resets all three.
  watch(
    [active, endpointKey, () => repo.repo?.path],
    () =>
    {
      if (active.value)
      {
        void listing.load();
      }
    },
    { immediate: true }
  );

  /** Which listing `contentEntry` came from. The blob waits on this, not `endpointKey`, which moves a read earlier while the entry is still the old revision's. */
  const contentKey = computed(() =>
  {
    if (active.value)
    {
      return listing.loadedKey.value;
    }
    else
    {
      return diff.loadedKey;
    }
  });

  watch(
    [showingContents, () => contentEntry.value?.path, contentKey],
    () =>
    {
      if (showingContents.value)
      {
        void blob.loadBlob();
      }
    },
    { immediate: true }
  );

  /**
   * Re-read both, without the endpoint having changed: what the `.git` watcher calls,
   * since working-tree/index listings change as files are saved and staged.
   */
  async function refresh(): Promise<void>
  {
    // Each half on its own terms, for the same reason they're gated separately above.
    if (active.value)
    {
      await listing.load();
    }
    if (showingContents.value)
    {
      await blob.loadBlob();
    }
  }

  return {
    entries: selection.entries,
    loading: listing.loading,
    error: listing.error,
    selectedPath: selection.selectedPath,
    selectedPaths: selection.selectedPaths,
    selectedEntry: selection.selectedEntry,
    selectedEntries: selection.selectedEntries,
    collapsedFolders: selection.collapsedFolders,
    blob: blob.blob,
    blobLoading: blob.blobLoading,
    blobError: blob.blobError,
    endpoint,
    endpointKey,
    isEmpty: listing.isEmpty,
    active,
    showingContents,
    contentEntry,
    select: selection.select,
    selectPaths: selection.selectPaths,
    setOrder: selection.setOrder,
    toggleFolder: selection.toggleFolder,
    expandAll: selection.expandAll,
    collapseAll: selection.collapseAll,
    reset,
    load: listing.load,
    loadBlob: blob.loadBlob,
    refresh
  };
});
