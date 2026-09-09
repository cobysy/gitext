<script setup lang="ts">
/**
 * The main window's diff: a reading surface, not an editing one. Monaco's own diff
 * editor draws it, with syntax colour, find, go-to-line and intra-line marking; the
 * commit screen's `StagingDiff.vue` is deliberately not this, since every line there is
 * a click target. Monaco never runs git: it renders only what `diff:patch` returned.
 */

import { computed, ref, watch } from 'vue';
import { applyMonacoTheme } from '@renderer/monaco.js';
import type * as monaco from '@renderer/monaco.js';
import { BINARY_NOTE, countChangedLines, submoduleNote } from '@renderer/model/patch.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useContextMenu } from '@renderer/composables/useContextMenu.js';
import { diffOptionsMenu } from '@renderer/menus/fileList.js';
import { resolveMenu, resolvedCommands } from '@renderer/menus/resolve.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import SegmentedSwitch from '@renderer/components/ui/SegmentedSwitch.vue';
import Glyph from '@renderer/components/ui/Glyph.vue';
import LineStats from '@renderer/components/ui/LineStats.vue';
import { filePaneViewMenu } from '@renderer/menus/fileList.js';
import { useFilePaneStore } from '@renderer/stores/filePane.js';
import { useDiffEditorPanes } from './useDiffEditorPanes.js';

const diff = useDiffStore();
const settings = useSettingsStore();
const ui = useUiStore();
const filePane = useFilePaneStore();
const commandContext = useCommandContext();

const DIFF_VIEW_MODE_SIDE_BY_SIDE = 'sideBySide';
const WHITESPACE_NONE = 'none';
const COMMAND_ID_VIEW_DIFF = 'files.viewDiff';
const COMMAND_ID_NEXT_DIFFERENCE = 'diff.nextDifference';
const COMMAND_ID_PREVIOUS_DIFFERENCE = 'diff.previousDifference';
const MONACO_TRIGGER_SOURCE_KEYBOARD = 'keyboard';
const MONACO_ACTION_DIFF_REVIEW_NEXT = 'editor.action.diffReview.next';
const MONACO_ACTION_DIFF_REVIEW_PREV = 'editor.action.diffReview.prev';

/** True when there is a real, new block to navigate the editor to. */
function canNavigateToBlock(
  editor: monaco.editor.IStandaloneDiffEditor | null,
  block: number,
  prev: number | undefined
): editor is monaco.editor.IStandaloneDiffEditor
{
  return !!editor && block !== prev && block >= 0;
}

/** Diff or whole file: the same switch `BlobViewer` draws, in the same place. */
const viewItems = computed(() =>
  resolvedCommands(resolveMenu(filePaneViewMenu, commandContext.value))
);

/** A file picked from the tree that this commit did not touch: not "nothing selected", since the whole-file switch beside this message can still show it. */
const noDiffForTreeFile = computed(
  () =>
    settings.settings.filesPaneMode === FILES_PANE_MODE_TREE &&
    filePane.wantedPath !== null &&
    diff.selectedFile === null
);

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(theme: 'light' | 'dark'): void
{
  applyMonacoTheme(theme);
}

watch(() => settings.effectiveTheme, applyTheme, { immediate: true });

const sideBySide = computed(() => settings.settings.diffViewMode === DIFF_VIEW_MODE_SIDE_BY_SIDE);

/** Two diff editors, stacked: one on screen, one being got ready behind it. See `useDiffEditorPanes` for why a file change needs two. */
const hostA = ref<HTMLElement | null>(null);
const hostB = ref<HTMLElement | null>(null);

const { front, shown, frontEditor } = useDiffEditorPanes({
  hostA,
  hostB,
  sideBySide: () => sideBySide.value,
  ignoreWhitespace: () => settings.settings.diffIgnoreWhitespace !== WHITESPACE_NONE,
  effectiveTheme: () => settings.effectiveTheme,
  applyTheme,
  patch: () => diff.patch,
  parsedFile: () => diff.parsedFile
});

// ── Difference navigation ────────────────────────────────────────────────────

// Wire F7 / Shift+F7 commands through Monaco's own navigator
watch(
  () => diff.focusedBlock,
  (block, prev) =>
  {
    // The one on screen: navigating the copy behind it would move a diff nobody is looking at
    const editor = frontEditor();
    if (!canNavigateToBlock(editor, block, prev))
    {
      return;
    }
    try
    {
      if (block > (prev ?? -1))
      {
        editor
          .getModifiedEditor()
          .trigger(MONACO_TRIGGER_SOURCE_KEYBOARD, MONACO_ACTION_DIFF_REVIEW_NEXT, null);
      }
      else
      {
        editor
          .getModifiedEditor()
          .trigger(MONACO_TRIGGER_SOURCE_KEYBOARD, MONACO_ACTION_DIFF_REVIEW_PREV, null);
      }
    }
    catch
    {
      // trigger may fail if no diff, not an error
    }
  }
);

function step(delta: number): void
{
  let commandId: string;
  if (delta > 0)
  {
    commandId = COMMAND_ID_NEXT_DIFFERENCE;
  }
  else
  {
    commandId = COMMAND_ID_PREVIOUS_DIFFERENCE;
  }
  void runCommand(commandId, commandContext.value);
}

// ── Header stats ─────────────────────────────────────────────────────────────

const fileStats = computed(() =>
{
  const parsed = shown.value?.parsed;
  if (parsed)
  {
    return countChangedLines(parsed);
  }
  else
  {
    return null;
  }
});

// The one thing here that reads the store rather than `shown`: F7/Shift+F7 step through the store's `aligned`, so a count elsewhere could name a number they don't honour.
const blockCount = computed(() => diff.aligned.blocks.length);

/**
 * The change git will not show as lines, said in words instead. A binary file or
 * submodule comes back as a patch with no usable text, and handing that to Monaco draws
 * an empty editor: a pane that looks broken rather than one with something to say.
 */
const untextualNote = computed<string | null>(() =>
{
  const file = shown.value?.parsed;
  if (!file)
  {
    return null;
  }
  if (file.isSubmodule)
  {
    return submoduleNote(file);
  }
  if (file.isBinary)
  {
    return BINARY_NOTE;
  }
  return null;
});

/** Whether the editors have anything worth drawing; a note goes over them when not. Both halves needed: a submodule's diff *does* parse to hunks, just unreadable ones. */
const untextual = computed(
  () => untextualNote.value !== null || (shown.value?.parsed?.hunks.length ?? 0) === 0
);

/**
 * The name over the diff, taken from the drawn patch rather than the selection: the two
 * disagree while a read is in flight, and a header following the selection would name a
 * file whose lines aren't underneath it. The full entry, not the path alone, because a rename draws as both names.
 */
const displayPath = computed(() =>
{
  const path = shown.value?.path;
  if (path === undefined)
  {
    return null;
  }
  const file = diff.files.find((entry) => entry.path === path);
  if (!file)
  {
    return path;
  }
  if (file.origPath)
  {
    return `${file.origPath} → ${file.path}`;
  }
  return file.path;
});

// ── Options menu ─────────────────────────────────────────────────────────────

const { menu, openBelow, close: closeMenu } = useContextMenu();

function openOptions(event: MouseEvent): void
{
  const items = resolveMenu(diffOptionsMenu, commandContext.value);
  if (!items.length)
  {
    return;
  }
  openBelow(event.currentTarget as HTMLElement, items);
}

function onMenuCommand(id: string): void
{
  closeMenu();
  void runCommand(id, commandContext.value);
}
</script>

<template>
  <section class="diff" @focusin="ui.focusPane('diff')">
    <!-- Always drawn, even with nothing to show: it carries the switch to the other pane, and a header that vanished with nothing selected would take the way out with it. -->
    <div class="bar">
      <span v-if="displayPath" class="path truncate">{{ displayPath }}</span>

      <LineStats v-if="fileStats" :added="fileStats.added" :deleted="fileStats.deleted" />

      <div class="spacer" />

      <span v-if="blockCount > 0" class="counter">
        {{ diff.focusedBlock >= 0 ? diff.focusedBlock + 1 : '-' }} of {{ blockCount }}
        {{ blockCount === 1 ? 'difference' : 'differences' }}
      </span>

      <button
        class="step"
        :disabled="diff.focusedBlock <= 0"
        title="Previous difference (Shift+F7)"
        aria-label="Previous difference"
        @click="step(-1)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M9 8L6 5L3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        class="step"
        :disabled="diff.focusedBlock >= blockCount - 1"
        title="Next difference (F7)"
        aria-label="Next difference"
        @click="step(1)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4L6 7L9 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <SegmentedSwitch :items="viewItems" @run="onMenuCommand">
        <template #icon="{ id }">
          <!-- The diff, or the file itself. -->
          <Glyph v-if="id === COMMAND_ID_VIEW_DIFF" name="diffFile" />
          <Glyph v-else name="textFile" />
        </template>
      </SegmentedSwitch>

      <button class="options" title="Diff options" aria-label="Diff options" @click="openOptions">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="2.5" r="1.2" fill="currentColor"/>
          <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
          <circle cx="7" cy="11.5" r="1.2" fill="currentColor"/>
        </svg>
      </button>
    </div>

    <!-- States read the *drawn* patch, never the selection or the store's latest: see
         `shown`. No "loading" state: the pane holds the last file until the next is
         drawn, same as `StagingDiff.vue`. Both editors stay laid out; the note goes
         *over* them so Monaco keeps the same size on both sides of a swap. Error first:
         a failed read nulls the patch, so testing "is there a patch" ahead of it would misreport a git failure as an empty pane. -->
    <div class="monaco-host">
      <div ref="hostA" class="monaco fill" :class="{ blank: front !== 0 || untextual }" />
      <div ref="hostB" class="monaco fill" :class="{ blank: front !== 1 || untextual }" />

      <p v-if="diff.patchError" class="placeholder error">{{ diff.patchError }}</p>
      <p v-else-if="noDiffForTreeFile" class="placeholder">
        {{ filePane.wantedPath }} is not one of the files this commit changed, so there is
        no diff for it here. Switch this pane to the whole file to read it.
      </p>
      <p v-else-if="!shown" class="placeholder">No file selected.</p>
      <p v-else-if="untextualNote" class="placeholder">{{ untextualNote }}</p>
      <p v-else-if="untextual" class="placeholder">No differences.</p>
    </div>

    <p v-if="shown?.truncated" class="placeholder truncated">
      This patch is too large to show in full; what is above is the start of it.
    </p>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @run="onMenuCommand"
      @close="closeMenu"
    />
  </section>
</template>

<style scoped src="@renderer/styles/paneBar.css"></style>
<style scoped src="@renderer/styles/monacoHost.css"></style>
<style scoped>
.diff {
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

.counter {
  font-size: var(--text-xs);
  color: var(--fg-muted);
  flex: none;
  white-space: nowrap;
}

.step,
.options {
  flex: none;
  display: flex;
  align-items: center;
  padding: 2px 4px;
  color: var(--fg-muted);
}

.step:hover:not(:disabled),
.options:hover { color: var(--fg); }

.step:disabled {
  color: var(--fg-subtle);
  opacity: 0.5;
}

/* The one box whose size never changes with what is in it. */

/* Keeps its box, invisible but measurable. `opacity`, not `visibility`: Monaco sets `visibility` on its own margin/ruler, which would win over an inherited `hidden`. */

.monaco-host >

p.placeholder.error { color: var(--danger); }

p.placeholder.truncated {
  border-top: 1px solid var(--border-subtle);
  color: var(--warning);
  flex: none;
}
</style>
