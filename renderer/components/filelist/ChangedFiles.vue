<script setup lang="ts">
/**
 * The file pane's list, in either of two things it can list. **Changed** is what
 * differs between the two ends of the diff pivot; **Tree** is what the newer end
 * *contains*, touched or not. One list with a mode, not two panes: rows, folders,
 * filter, arrow keys and context menu are identical; only where entries come from
 * differs. Either can draw as a tree or a flat list, a per-pane setting since a wide commit reads unreadable flat. Virtualized: a repository's tree is thousands of rows.
 */

import { computed, ref } from 'vue';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useContextMenu } from '@renderer/composables/useContextMenu.js';
import { ROW_KIND_FILE, ROW_KIND_FOLDER, type FileRow } from '@renderer/filetree.js';
import {
  MARK_LABEL,
  MARK_SUBMODULE,
  MARK_TITLE,
  STATUS_LETTER,
  rowMark,
  type PaneEntry
} from '@renderer/model/fileRowDescription.js';
import { filesPaneModeMenu, fileListMenu, fileListViewMenu } from '@renderer/menus/fileList.js';
import { plainText } from '@renderer/model/codeText.js';
import { resolveMenu, resolvedCommands } from '@renderer/menus/resolve.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFilePaneStore } from '@renderer/stores/filePane.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import CodeText from '@renderer/components/ui/CodeText.vue';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import SegmentedSwitch from '@renderer/components/ui/SegmentedSwitch.vue';
import Glyph from '@renderer/components/ui/Glyph.vue';
import LineStats from '@renderer/components/ui/LineStats.vue';
import ListShapeButton from '@renderer/components/ui/ListShapeButton.vue';
import Twisty from '@renderer/components/ui/Twisty.vue';
import FilterBox from '@renderer/components/ui/FilterBox.vue';
import { usePaneSource } from './usePaneSource.js';
import { ROW_HEIGHT, useFileListNavigation } from './useFileListNavigation.js';

const INDENT = 12;
const COMMAND_ID_VIEW_CHANGED = 'files.viewChanged';

// `diff`/`fileTree` are read directly here too (not only inside `usePaneSource`), for the loading/empty-state text below, a template-only concern.
const diff = useDiffStore();
const fileTree = useFileTreeStore();
const settings = useSettingsStore();
const pane = useFilePaneStore();
const ui = useUiStore();
const commandContext = useCommandContext();

const scroller = ref<HTMLElement | null>(null);

/** Which list backs the pane, and everything that means something different by mode. */
const {
  isTree,
  source,
  selectedPath,
  collapsed,
  selectPath,
  selectPaths,
  pickedHere,
  toggleFolder,
  heading,
  statusOfRow,
  linesOfRow,
  titleOfRow
} = usePaneSource();

/**
 * What the change cost, in lines, for the row's far end: git's own `--numstat` counts.
 * A file git counted nothing for draws none, rather than a pair of zeroes that would
 * read as "this changed nothing": a binary file, or an untracked one.
 */
function hasLines(row: FileRow<PaneEntry>): boolean
{
  return linesOfRow(row) !== null;
}

function addedOf(row: FileRow<PaneEntry>): number
{
  return linesOfRow(row)?.added ?? 0;
}

function deletedOf(row: FileRow<PaneEntry>): number
{
  return linesOfRow(row)?.deleted ?? 0;
}

/**
 * Whether a file is being *followed*, not merely shown: not the same as "is a row
 * selected", since the changed list opens its first file with nothing wanted. What the clear button undoes: see `stores/filePane.ts`.
 */
const following = computed(() => pane.wantedPath !== null);

/** Stop following the open file, through the registry (not the store directly) since every action here is a command, the same one the view menu offers. */
function stopFollowing(): void
{
  void onMenuCommand('files.stopFollowing');
}

/** What's on screen, filtered, tree-or-flat, virtualized, and the keyboard over it. */
const {
  filter,
  rows,
  virtualRows,
  totalHeight,
  fileCount,
  focusedKey,
  pathsUnder,
  isFolderSelected,
  isFolderHighlighted,
  onRowClick,
  onKeydown
} = useFileListNavigation({
  source: () => source.value,
  collapsed: () => collapsed.value,
  fileListView: () => settings.settings.fileListView,
  dense: () => settings.settings.fileListDenseTree,
  selectedPath: () => selectedPath.value,
  selectPath,
  pickedHere: () => pickedHere.value,
  toggleFolder,
  setOrder: (paths) =>
  {
    if (isTree.value)
    {
      fileTree.setOrder(paths);
    }
    else
    {
      diff.setOrder(paths);
    }
  },
  following: () => following.value,
  stopFollowing,
  scroller
});

/** The two modes, resolved from the registry so the labels on them live in one place. */
const modeItems = computed(() =>
  resolvedCommands(resolveMenu(filesPaneModeMenu, commandContext.value))
);

/**
 * Right-clicking a row: the file menu, over what the click means. A row already in the
 * selection is left alone (the menu acts on all five, not just the one under the
 * pointer); a row outside it replaces the selection, since a menu acting off screen
 * would lie. A folder is the same menu over the files inside it.
 */
function onContextMenu(row: FileRow<PaneEntry>, event: MouseEvent): void
{
  event.preventDefault();
  focusedKey.value = row.key;

  if (row.kind === ROW_KIND_FILE)
  {
    if (!pickedHere.value.has(row.key))
    {
      selectPath(row.key);
    }
  }
  else
  {
    const paths = pathsUnder(row.key);
    if (paths.length === 0)
    {
      return;
    }
    if (!isFolderSelected(row.key))
    {
      selectPaths(paths);
    }
  }

  // Resolved once, at open: `useCommandContext` reads the selection the lines above just set, and computed properties settle synchronously.
  openFrom(event, resolveMenu(fileListMenu, commandContext.value));
}

/** The empty space below the last row: the list itself is the only operand there. */
function onBackgroundContextMenu(event: MouseEvent): void
{
  event.preventDefault();
  openFrom(event, resolveMenu(fileListViewMenu, commandContext.value));
}

// ── Menus ────────────────────────────────────────────────────────────────────

const { menu, openFrom, openBelow, close: closeMenu } = useContextMenu();

function openViewMenu(event: MouseEvent): void
{
  openBelow(event.currentTarget as HTMLElement, resolveMenu(fileListViewMenu, commandContext.value));
}

async function onMenuCommand(id: string): Promise<void>
{
  closeMenu();
  const ran = await runCommand(id, commandContext.value);
  if (!ran)
  {
    ui.toast(`"${id}" is not available yet.`, 'info');
  }
}
</script>

<template>
  <!-- `focusin`, not `focus`: fires for the filter box and header buttons too, all of
       which mean "the keyboard is in this pane" as much as a row does. -->
  <section class="files" tabindex="0" @keydown="onKeydown" @focusin="ui.focusPane('fileList')">
    <header class="bar">
      <!-- Two commands drawn as a switch, not a menu: the pane's first question, with two answers, and one click must be enough to change it. -->
      <SegmentedSwitch :items="modeItems" @run="onMenuCommand">
        <template #icon="{ id }">
          <!-- What changed, or what the repository contains. -->
          <Glyph v-if="id === COMMAND_ID_VIEW_CHANGED" name="diffFile" />
          <Glyph v-else name="folder" />
        </template>
      </SegmentedSwitch>
      <span class="title">{{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }}</span>
      <span class="range" :title="plainText(heading)"><CodeText :text="heading" /></span>

      <!-- Only while a file is being followed: an always-present button would claim the pane is doing something it isn't. `Esc` on the list does the same. -->
      <button
        v-if="following"
        class="clear"
        type="button"
        :title="`Stop following ${pane.wantedPath} from one revision to the next (Esc)`"
        aria-label="Stop following this file"
        @click="stopFollowing"
      >
        ×
      </button>

      <FilterBox v-model="filter" class="search" dense />
      <ListShapeButton @open="openViewMenu" />
      <!-- Hides the whole band, list and diff together: they are one pane, and the
           Commit pane beside the grid has a ✕ of its own. -->
      <button
        class="close"
        type="button"
        title="Hide the files and diff pane"
        @click="settings.patch({ showFilePane: false })"
      >✕</button>
    </header>

    <template v-if="isTree">
      <p v-if="fileTree.error" class="placeholder error">{{ fileTree.error }}</p>
      <p v-else-if="fileTree.loading && fileTree.entries.length === 0" class="placeholder">Loading…</p>
      <p v-else-if="fileTree.endpoint === null" class="placeholder">
        Select a commit to see what it contains.
      </p>
      <p v-else-if="fileTree.entries.length === 0" class="placeholder">There are no files here.</p>
      <p v-else-if="rows.length === 0" class="placeholder">No file matches “{{ filter }}”.</p>
    </template>
    <template v-else>
      <p v-if="diff.filesError" class="placeholder error">{{ diff.filesError }}</p>
      <p v-else-if="diff.filesLoading && diff.files.length === 0" class="placeholder">Loading…</p>
      <p v-else-if="diff.range === null" class="placeholder">Select a commit to see what it changed.</p>
      <p v-else-if="diff.files.length === 0" class="placeholder">No changes between these two.</p>
      <p v-else-if="rows.length === 0" class="placeholder">No file matches “{{ filter }}”.</p>
    </template>

    <div ref="scroller" class="list" @contextmenu.self="onBackgroundContextMenu">
      <div class="canvas" :style="{ height: `${totalHeight}px` }" @contextmenu.self="onBackgroundContextMenu">
        <div
          v-for="virtualRow in virtualRows"
          :key="rows[virtualRow.index]!.key"
          class="row"
          :class="[
            rows[virtualRow.index]!.kind,
            statusOfRow(rows[virtualRow.index]!) ?? '',
            {
              submodule: rowMark(rows[virtualRow.index]!) === MARK_SUBMODULE,
              selected:
                pickedHere.has(rows[virtualRow.index]!.key) ||
                (rows[virtualRow.index]!.kind === ROW_KIND_FOLDER &&
                  isFolderHighlighted(rows[virtualRow.index]!.key)),
              // The one row the diff pane is showing, marked apart from the rest of a multi-file selection.
              primary: rows[virtualRow.index]!.key === selectedPath,
              focused: rows[virtualRow.index]!.key === focusedKey
            }
          ]"
          :style="{
            transform: `translateY(${virtualRow.start}px)`,
            height: `${ROW_HEIGHT}px`,
            paddingLeft: `${4 + rows[virtualRow.index]!.depth * INDENT}px`
          }"
          :title="titleOfRow(rows[virtualRow.index]!)"
          @click="onRowClick(rows[virtualRow.index]!, $event)"
          @contextmenu="onContextMenu(rows[virtualRow.index]!, $event)"
        >
          <template v-if="rows[virtualRow.index]!.kind === ROW_KIND_FOLDER">
            <Twisty :open="rows[virtualRow.index]!.expanded" />
            <span class="name folder-name">{{ rows[virtualRow.index]!.label }}</span>
            <span class="count">{{ rows[virtualRow.index]!.count }}</span>
          </template>

          <template v-else>
            <!-- Drawn on every file row even when blank: a gutter appearing only on touched files would step every other name sideways. -->
            <span class="status">
              {{ statusOfRow(rows[virtualRow.index]!)
                ? STATUS_LETTER[statusOfRow(rows[virtualRow.index]!)!]
                : '' }}
            </span>
            <span class="path">
              <span class="dir">{{ rows[virtualRow.index]!.dir }}</span
              ><span class="name">{{ rows[virtualRow.index]!.label }}</span>
            </span>
            <!-- What the row is, when not an ordinary file: clicking it won't show a diff. -->
            <span
              v-if="rowMark(rows[virtualRow.index]!)"
              class="mark"
              :title="MARK_TITLE[rowMark(rows[virtualRow.index]!)!]"
            >
              {{ MARK_LABEL[rowMark(rows[virtualRow.index]!)!] }}
            </span>
            <!-- Right-aligned, so the counts read down the pane as a column rather than trailing each name. -->
            <LineStats
              v-if="hasLines(rows[virtualRow.index]!)"
              :added="addedOf(rows[virtualRow.index]!)"
              :deleted="deletedOf(rows[virtualRow.index]!)"
              column
            />
          </template>
        </div>
      </div>
    </div>

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

<style scoped src="@renderer/styles/listRow.css"></style>
<style scoped src="@renderer/styles/paneBar.css"></style>
<style scoped>
.files {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
  outline: none;
}

/* One control with two halves, not two buttons: a gap would read as two independent toggles that could both be off. */
.title {
  font-size: var(--text-xs);
  font-weight: 600;
  flex: none;
}

/*
 * The first thing to give up its room: the filter and view button must not be pushed off
 * a narrow pane.
 *
 * But it gives up room down to a floor, not to nothing. Shrinking without one took
 * "Nothing selected" to 28px of a needed 89 and drew `Not…`, which is not a shorter way
 * of saying it: it is three characters of noise where a reader expects a fact. Past the
 * floor it stops shrinking and the filter box, which has a floor of its own, gives up the
 * next pixels instead. The `title` carries the full text either way.
 */
.range {
  font-size: var(--text-xs);
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 6em;
}


/* The box and the button that empties it, sitting inside it rather than beside it: one more control in the row would cost the width it just gained. */
.search {
  /* Grows into whatever the range leaves and shrinks with it, rather than a fixed width the bar has no room for. */
  flex: 1 1 84px;
  min-width: 64px;
  max-width: 160px;
}

/* The pane's own ✕, drawn like the Commit pane's rather than like the round × above:
   it closes the pane instead of undoing something inside it. */
.close {
  flex: none;
  background: none;
  border: none;
  color: var(--fg-subtle);
  font-size: var(--text-xs);
  padding: 0 var(--space-1);
}

.close:hover {
  color: var(--fg);
}

/* The same round × the filter box draws, for the same reason: it undoes something the
   pane is doing. No border or fill of its own, or a mark this small reads as one more
   button in a row that already has three. */
.clear {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 50%;
  font-size: var(--text-sm);
  line-height: 1;
  color: var(--fg-subtle);
}

.clear:hover {
  color: var(--fg);
  background: var(--bg-hover);
}

.list {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.canvas {
  position: relative;
  width: 100%;
}

.row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-right: var(--space-2);
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: default;
  box-sizing: border-box;
}

/* The one row the diff pane is showing, when the selection holds several: five selected rows and one diff needs the pane to say which. */
.row.primary {
  box-shadow: inset 2px 0 0 var(--accent);
}

/* The keyboard's row when it is not selected: a folder, mostly. */
.row.focused:not(.selected):not(.primary) {
  box-shadow: inset 0 0 0 1px var(--border);
}

/* Quieter than the folder's own name, which is what the row is for. */
.twisty {
  color: var(--fg-subtle);
}

.folder-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  flex: none;
}

/* An aside rather than part of the name; `.path` takes the slack, so this sits at the end. */
.mark {
  flex: none;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  font-family: var(--font-mono);
}

.status {
  flex: none;
  width: 12px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--fg-muted);
}

/* The same four colours the commit screen's lists use: one scheme for one alphabet. */
.row.added .status,
.row.untracked .status,
.row.copied .status {
  color: var(--success);
}

.row.modified .status,
.row.typechange .status {
  color: var(--warning);
}

.row.renamed .status {
  color: var(--accent);
}

.row.deleted .status,
.row.conflicted .status {
  color: var(--danger);
}

/* Takes whatever the row does not need, which is what pushes the mark and the counts to the far end. */
.path {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}


.name {
  color: var(--fg);
}

.row.deleted .name {
  text-decoration: line-through;
  color: var(--fg-muted);
}
</style>
