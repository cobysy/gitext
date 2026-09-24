<script setup lang="ts">
/**
 * File History and Blame: one window, two tabs. Browse dialog (no mutations, no useDialog().run).
 */

import { computed, nextTick, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { applyMonacoTheme } from '@renderer/monaco.js';
import { languageForPath } from '@renderer/monacoLang.js';
import { isBlobShowable } from '@renderer/model/blob.js';
import { formatCommitDate, shortSha } from '@renderer/format.js';
import { parsePatch, type PatchFile } from '@renderer/model/patch.js';
import {
  DIFF_VIEW_SIDE_BY_SIDE,
  FILE_STATUS_MODIFIED,
  IGNORE_WHITESPACE_NONE,
  OBJECT_KIND_BLOB,
  type BlameFile,
  type CommitRow
} from '@shared/types.js';
import type { DiffEndpoint, DiffFileEntry, DiffRange } from '@shared/diff.js';
import type { BlobContents, TreeEntry } from '@shared/tree.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import BlamePane from '@renderer/components/diff/BlamePane.vue';
import { useDiffEditorPanes } from '@renderer/components/diff/useDiffEditorPanes.js';
import { useReadOnlyEditor } from '@renderer/components/diff/useReadOnlyEditor.js';

// Tab values
const TAB_DIFF = 'diff';
const TAB_BLAME = 'blame';
const TAB_VIEW = 'view';

// Diff endpoint kinds
const KIND_WORKING_TREE = 'workingTree';
const KIND_INDEX = 'index';
const KIND_COMMIT = 'commit';

const props = withDefaults(
  defineProps<{
    filePath: string;
    revision: DiffEndpoint | null;
    tab?: typeof TAB_DIFF | typeof TAB_BLAME | typeof TAB_VIEW;
  }>(),
  { tab: TAB_DIFF }
);

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const settings = useSettingsStore();
const { close } = useDialog();

// ── The list ────────────────────────────────────────────────────────────────

const commits = ref<CommitRow[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

/** What the right-hand pane is showing: a commit, or the working tree. */
const selected = ref<DiffEndpoint>(props.revision ?? { kind: KIND_WORKING_TREE });
const selectedSha = computed(() =>
{
  if (selected.value.kind === KIND_COMMIT)
  {
    return selected.value.sha;
  }
  else
  {
    return null;
  }
}
);
const selectedCommit = computed(
  () => commits.value.find((c) => c.sha === selectedSha.value) ?? null
);

const activeTab = ref<typeof TAB_DIFF | typeof TAB_BLAME | typeof TAB_VIEW>(props.tab);

const dialogTitle = computed(() =>
{
  const name = props.filePath.split('/').pop() ?? props.filePath;
  const label = {
    [TAB_DIFF]: 'File History',
    [TAB_BLAME]: 'Blame',
    [TAB_VIEW]: 'View'
  }[activeTab.value];
  // No name, no separator: an absent path used to leave the window headed "File History:"
  // with a colon introducing nothing.
  if (!name)
  {
    return label;
  }
  return `${label}: ${name}`;
});

const listEl = ref<HTMLElement | null>(null);

function select(endpoint: DiffEndpoint): void
{
  selected.value = endpoint;
  // Clicking a row in the list is already scrolled into view; this matters for the
  // other way in: a blame line or "Blame Previous Revision" naming a commit that may
  // be nowhere near the current scroll position. A no-op when it's already visible.
  void nextTick(() =>
  {
    listEl.value?.querySelector('.entry.current')?.scrollIntoView({ block: 'nearest' });
  });
}

async function load(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  loading.value = true;
  loadError.value = null;
  try
  {
    commits.value = await api['file:history'](path, props.filePath);
  }
  catch (err)
  {
    loadError.value = toMessage(err);
  }
  finally
  {
    loading.value = false;
  }
}

void load();

// ── Diff tab ────────────────────────────────────────────────────────────────
//
// The file's own change at the selected commit, not the whole commit's diff. The
// parent comes from the commit row already in hand, so this costs no extra git call.

const diffFileEntry = computed<DiffFileEntry>(() => ({
  path: props.filePath,
  status: FILE_STATUS_MODIFIED,
  score: 0,
  kind: OBJECT_KIND_BLOB,
  mode: '100644',
  binary: false
}));

const diffRange = computed<DiffRange | null>(() =>
{
  if (selected.value.kind === KIND_WORKING_TREE)
  {
    return { from: { kind: KIND_INDEX }, to: { kind: KIND_WORKING_TREE } };
  }
  if (selected.value.kind !== KIND_COMMIT)
  {
    return null;
  }
  const parent = selectedCommit.value?.parents[0];
  let from: { kind: typeof KIND_COMMIT; sha: string } | null;
  if (parent)
  {
    from = { kind: KIND_COMMIT, sha: parent };
  }
  else
  {
    from = null;
  }
  return { from, to: selected.value };
});

const patch = ref<{ path: string; text: string; truncated: boolean } | null>(null);
const patchLoading = ref(false);
const patchError = ref<string | null>(null);
const parsedFile = computed<PatchFile | null>(() => parsePatch(patch.value?.text ?? '')[0] ?? null);

async function loadDiff(): Promise<void>
{
  const path = repo.repo?.path;
  const range = diffRange.value;
  patchError.value = null;
  if (!path || !range)
  {
    patch.value = null;
    return;
  }
  patchLoading.value = true;
  try
  {
    patch.value = await api['diff:patch'](path, range, diffFileEntry.value, {});
  }
  catch (err)
  {
    patchError.value = toMessage(err);
    patch.value = null;
  }
  finally
  {
    patchLoading.value = false;
  }
}

const hostA = ref<HTMLElement | null>(null);
const hostB = ref<HTMLElement | null>(null);

const { front, shown } = useDiffEditorPanes({
  hostA,
  hostB,
  sideBySide: () => settings.settings.diffViewMode === DIFF_VIEW_SIDE_BY_SIDE,
  ignoreWhitespace: () => settings.settings.diffIgnoreWhitespace !== IGNORE_WHITESPACE_NONE,
  effectiveTheme: () => settings.effectiveTheme,
  applyTheme: applyMonacoTheme,
  patch: () =>
  {
    if (patch.value)
    {
      return { path: patch.value.path, truncated: patch.value.truncated };
    }
    else
    {
      return null;
    }
  },
  parsedFile: () => parsedFile.value
});

// ── Blame tab ───────────────────────────────────────────────────────────────

const blame = ref<BlameFile | null>(null);
const blameLoading = ref(false);
const blameError = ref<string | null>(null);

async function loadBlame(): Promise<void>
{
  const path = repo.repo?.path;
  blameError.value = null;
  if (!path)
  {
    blame.value = null;
    return;
  }
  blameLoading.value = true;
  try
  {
    blame.value = await api['file:blame'](path, selected.value, props.filePath);
  }
  catch (err)
  {
    blameError.value = toMessage(err);
    blame.value = null;
  }
  finally
  {
    blameLoading.value = false;
  }
}

function selectFromBlameLine(sha: string): void
{
  select({ kind: KIND_COMMIT, sha });
}

const canBlamePrevious = computed(() => selected.value.kind === KIND_COMMIT);

/** Re-blame the parent of the commit currently blamed, at the same line number: no
 * hunk-remapping. An occasional few lines of drift across a heavily-edited commit is the
 * accepted trade. */
async function blamePrevious(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path || selected.value.kind !== KIND_COMMIT)
  {
    return;
  }
  const parents = await api['repo:parents'](path, selected.value.sha);
  const parent = parents[0];
  if (parent)
  {
    select({ kind: KIND_COMMIT, sha: parent.sha });
  }
}

// ── View tab ────────────────────────────────────────────────────────────────

const viewBlob = ref<BlobContents | null>(null);
const viewLoading = ref(false);
const viewError = ref<string | null>(null);

async function loadView(): Promise<void>
{
  const path = repo.repo?.path;
  viewError.value = null;
  if (!path)
  {
    viewBlob.value = null;
    return;
  }
  viewLoading.value = true;
  const entry: TreeEntry = { path: props.filePath, kind: OBJECT_KIND_BLOB, mode: '100644' };
  try
  {
    viewBlob.value = await api['tree:blob'](path, selected.value, entry);
  }
  catch (err)
  {
    viewError.value = toMessage(err);
    viewBlob.value = null;
  }
  finally
  {
    viewLoading.value = false;
  }
}

const viewContainer = ref<HTMLElement | null>(null);

useReadOnlyEditor({
  host: viewContainer,
  effectiveTheme: () => settings.effectiveTheme,
  uriTag: `file-history/view/${props.filePath}`,
  content: () =>
  {
    const b = viewBlob.value;
    if (!isBlobShowable(b))
    {
      return null;
    }
    return { text: b.text, language: languageForPath(props.filePath) };
  }
});

// ── Load whichever tab is in front, whenever what it is showing changes ──────

watch(
  [selected, activeTab],
  () =>
  {
    switch (activeTab.value)
    {
      case TAB_DIFF:
        void loadDiff();
        break;
      case TAB_BLAME:
        void loadBlame();
        break;
      default:
        void loadView();
        break;
    }
  },
  { immediate: true }
);
</script>

<template>
  <DialogFrame :title="dialogTitle" fixed-height @close="emit('close')">
    <div class="history">
      <ul ref="listEl" class="list side">
        <li>
          <button
            class="entry"
            :class="{ current: selected.kind === KIND_WORKING_TREE }"
            @click="select({ kind: KIND_WORKING_TREE })"
          >
            <span class="title">Working directory</span>
            <span class="detail">Uncommitted changes</span>
          </button>
        </li>
        <li v-if="loading" class="placeholder">Reading the file's history…</li>
        <li v-else-if="loadError" class="placeholder error">{{ loadError }}</li>
        <template v-else>
          <li v-for="commit in commits" :key="commit.sha">
            <button
              class="entry"
              :class="{ current: selectedSha === commit.sha }"
              @click="select({ kind: KIND_COMMIT, sha: commit.sha })"
            >
              <span class="title truncate">{{ commit.subject }}</span>
              <span class="detail truncate">
                <code>{{ shortSha(commit.sha) }}</code> · {{ commit.authorName }} ·
                {{ formatCommitDate(commit.authorDate, settings.settings.dateFormat) }}
              </span>
            </button>
          </li>
        </template>
      </ul>

      <div class="detail-pane">
        <div class="tabs">
          <button :class="{ active: activeTab === TAB_DIFF }" @click="activeTab = TAB_DIFF">
            Diff
          </button>
          <button :class="{ active: activeTab === TAB_BLAME }" @click="activeTab = TAB_BLAME">
            Blame
          </button>
          <button :class="{ active: activeTab === TAB_VIEW }" @click="activeTab = TAB_VIEW">
            View
          </button>
          <span class="spacer" />
          <button
            v-if="activeTab === TAB_BLAME"
            :disabled="!canBlamePrevious"
            @click="blamePrevious"
          >
            Blame Previous Revision
          </button>
        </div>

        <!-- All three panes stay mounted always, rather than each toggled by `v-if`:
             the same reason `DiffViewer.vue`'s two Monaco panes never toggle by `v-if`:
             an element that does not exist yet when a composable's `onMounted` runs
             never gets a Monaco editor at all, and nothing here would ever retry. -->
        <div class="monaco-host">
          <div class="pane" :class="{ hidden: activeTab !== TAB_DIFF }">
            <div ref="hostA" class="monaco fill" :class="{ blank: front !== 0 }" />
            <div ref="hostB" class="monaco fill" :class="{ blank: front !== 1 }" />
            <p v-if="activeTab === TAB_DIFF && patchError" class="placeholder error">
              {{ patchError }}
            </p>
            <p v-else-if="activeTab === TAB_DIFF && !shown" class="placeholder">
              {{ patchLoading ? 'Reading…' : 'No changes.' }}
            </p>
          </div>

          <div class="pane blame" :class="{ hidden: activeTab !== TAB_BLAME }">
            <BlamePane
              :blame="blame"
              :path="props.filePath"
              :uri-tag="`file-history/blame/${props.filePath}`"
              @pick="selectFromBlameLine"
            />
            <p v-if="activeTab === TAB_BLAME && blameError" class="placeholder error">
              {{ blameError }}
            </p>
            <p v-else-if="activeTab === TAB_BLAME && blameLoading" class="placeholder">
              Reading…
            </p>
          </div>

          <div class="pane" :class="{ hidden: activeTab !== TAB_VIEW }">
            <div ref="viewContainer" class="monaco fill" />
            <p v-if="activeTab === TAB_VIEW && viewError" class="placeholder error">
              {{ viewError }}
            </p>
            <p v-else-if="activeTab === TAB_VIEW && viewLoading" class="placeholder">
              Reading…
            </p>
            <p v-else-if="activeTab === TAB_VIEW && viewBlob?.missing" class="placeholder">
              This file is not in the selected revision.
            </p>
            <p v-else-if="activeTab === TAB_VIEW && viewBlob?.submodule" class="placeholder">
              A submodule, recorded here as one commit.
            </p>
            <p v-else-if="activeTab === TAB_VIEW && viewBlob?.binary" class="placeholder">
              This is a binary file; there is nothing to show as text.
            </p>
          </div>
        </div>
      </div>
    </div>

    <template #actions>
      <button @click="close">Close</button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped src="@renderer/styles/monacoHost.css"></style>
<style scoped>
.history {
  display: flex;
  gap: var(--space-3);
  align-items: stretch;
  min-height: 0;
  height: 100%;
}

.side {
  flex: none;
  width: 300px;
}

.detail-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}

.tabs button {
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  color: var(--fg-subtle);
  font-size: var(--text-sm);
}

.tabs button.active {
  background: var(--bg-subtle);
  color: var(--fg);
  font-weight: 600;
}

/* The one box whose size never changes with what tab is in it. */

/* All three stay mounted (see the template's own comment on why) and stack, each
   filling `.body`; `.hidden` is what actually switches which one is on screen. */
.pane {
  position: absolute;
  inset: 0;
}

.pane.blame {
  display: flex;
  min-height: 0;
}

.pane.hidden {
  display: none;
}

p.placeholder.error {
  color: var(--danger);
}
</style>
