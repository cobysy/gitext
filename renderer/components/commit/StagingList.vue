<script setup lang="ts">
/**
 * One of the commit screen's two file lists. The same component for both sides: they
 * differ only in which way their row button moves a file, which follows from `side`.
 * Flat, not a tree: this list is read as a checklist, and a tree of mostly-folders would put the thing being checked one level further away.
 */

import { computed, ref } from 'vue';
import { STAGING_SIDE_STAGED, useStagingStore, type StagingSide } from '@renderer/stores/staging.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { stagingListMenu, stagingListViewMenu } from '@renderer/menus/staging.js';
import { resolveMenu, type ResolvedItem } from '@renderer/menus/resolve.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import FilterBox from '@renderer/components/ui/FilterBox.vue';
import LineStats from '@renderer/components/ui/LineStats.vue';
import { toFilePath, type FilePath } from '@renderer/model/paths.js';
import { ROW_KIND_FOLDER } from '@renderer/filetree.js';
import type { DiffFileEntry } from '@shared/diff.js';
import { useStagingRows } from './useStagingRows.js';
import { useStagingSelection } from './useStagingSelection.js';
import Twisty from '@renderer/components/ui/Twisty.vue';
import ListShapeButton from '@renderer/components/ui/ListShapeButton.vue';

const props = defineProps<{
  side: StagingSide;
  title: string;
  files: DiffFileEntry[];
}>();

const staging = useStagingStore();
const settings = useSettingsStore();
const commandContext = useCommandContext();

/** What is currently drawn: the filter, the row shape, and how a row's status reads. */
const {
  filter,
  shown,
  rows,
  toggleFolder,
  letterOf,
  flagOf,
  flagTitle,
  pathsUnder,
  isFolderSelected: isFolderSelectedIn,
  isFolderHighlighted: isFolderHighlightedIn
} = useStagingRows({
  side: () => props.side,
  files: () => props.files
});

/** Picking files, and moving them across to the other list. */
const {
  selectedHere,
  selectedCount,
  isSelected,
  isPrimary,
  isFolderSelected,
  onRowClick,
  onFolderClick: onFolderClickIn,
  move,
  moveFolder,
  moveAll,
  onListKeydown
} = useStagingSelection({
  side: () => props.side,
  pathsUnder,
  isFolderSelected: isFolderSelectedIn
});

function onFolderClick(key: string, event: MouseEvent): void
{
  onFolderClickIn(key, event, toggleFolder);
}

const isFolderHighlighted = (key: string): boolean =>
  isFolderHighlightedIn(key, (path) => selectedHere.value.has(path));

/**
 * What the change cost, in lines, for the row's far end: the `--numstat` counts the
 * listing already carries. An untracked file has none, since git mentions it in no diff.
 */
function addedOf(file: DiffFileEntry): number
{
  return file.lines?.added ?? 0;
}

function deletedOf(file: DiffFileEntry): number
{
  return file.lines?.deleted ?? 0;
}

// ── Menus ────────────────────────────────────────────────────────────────────

const menu = ref<{ items: ResolvedItem[]; x: number; y: number } | null>(null);

/** Right-click. A row outside the selection replaces it first: acting on five other files instead of the one clicked is the classic way to lose work. */
function onRowContextMenu(file: DiffFileEntry, event: MouseEvent): void
{
  let selected: FilePath[];
  if (staging.side === props.side)
  {
    selected = staging.selectedPaths;
  }
  else
  {
    selected = [];
  }
  if (!selected.includes(toFilePath(file.path)))
  {
    staging.select(props.side, file.path);
  }
  else
  {
    staging.side = props.side;
  }
  openMenu(stagingListMenu, event.clientX, event.clientY);
}

/** Right-clicking a folder: the same menu, on the files inside. Selecting them first is what makes that true; a folder already wholly selected is left alone. */
function onFolderContextMenu(key: string, event: MouseEvent): void
{
  const paths = pathsUnder(key);
  if (paths.length === 0)
  {
    return;
  }
  if (!isFolderSelected(key))
  {
    staging.selectPaths(props.side, paths);
  }
  else
  {
    staging.side = props.side;
  }
  openMenu(stagingListMenu, event.clientX, event.clientY);
}

/** The empty space below the last row: the list itself is the only operand there, the same rule the file pane follows. */
function onBackgroundContextMenu(event: MouseEvent): void
{
  event.preventDefault();
  staging.side = props.side;
  openMenu(stagingListViewMenu, event.clientX, event.clientY);
}

function openMenu(nodes: Parameters<typeof resolveMenu>[0], x: number, y: number): void
{
  const items = resolveMenu(nodes, commandContext.value);
  if (items.length)
  {
    menu.value = { items, x, y };
  }
}

function onViewButton(event: MouseEvent): void
{
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  staging.side = props.side;
  openMenu(stagingListViewMenu, box.left, box.bottom + 2);
}

function onMenuCommand(id: string): void
{
  menu.value = null;
  void runCommand(id, commandContext.value);
}

const allLabel = computed(() =>
{
  if (props.side === STAGING_SIDE_STAGED)
  {
    return 'Unstage All';
  }
  else
  {
    return 'Stage All';
  }
});
const moveTitle = computed(() =>
{
  let verb;
  if (props.side === STAGING_SIDE_STAGED)
  {
    verb = 'Unstage';
  }
  else
  {
    verb = 'Stage';
  }
  if (selectedCount.value > 1)
  {
    return `${verb} the selected files`;
  }
  else
  {
    return `${verb} this file`;
  }
});
const folderMoveTitle = computed(() =>
{
  if (props.side === STAGING_SIDE_STAGED)
  {
    return 'Unstage everything in here';
  }
  else
  {
    return 'Stage everything in here';
  }
}
);
const moveGlyph = computed(() =>
{
  if (props.side === STAGING_SIDE_STAGED)
  {
    return '←';
  }
  else
  {
    return '→';
  }
});
</script>

<template>
  <section class="staging-list">
    <header class="head">
      <h3>
        {{ title }} ({{ files.length }})
        <!-- Only past one: "1 selected" would just repeat what the highlight already says. -->
        <span v-if="selectedCount > 1" class="picked">{{ selectedCount }} selected</span>
      </h3>
      <button :disabled="files.length === 0" @click="moveAll">{{ allLabel }}</button>
      <ListShapeButton @open="onViewButton" />
    </header>

    <div v-if="settings.settings.stagingFilterVisible" class="filter">
      <FilterBox v-model="filter" :placeholder="`Filter ${title.toLowerCase()}`" />
    </div>

    <div
      class="rows"
      tabindex="0"
      @keydown="onListKeydown"
      @contextmenu.self="onBackgroundContextMenu"
    >
      <p v-if="files.length === 0" class="empty">
        {{ side === STAGING_SIDE_STAGED ? 'Nothing staged yet.' : 'No unstaged changes.' }}
      </p>
      <p v-else-if="shown.length === 0" class="empty">No matches.</p>

      <template v-for="row in rows" :key="row.key">
        <div
          v-if="row.kind === ROW_KIND_FOLDER"
          class="row folder"
          :class="{ selected: isFolderHighlighted(row.key) }"
          :style="{ paddingLeft: `${row.depth * 12 + 8}px` }"
          :title="`${row.label}, click to fold, Shift-click to select its files`"
          @click="onFolderClick(row.key, $event)"
          @contextmenu.prevent="onFolderContextMenu(row.key, $event)"
        >
          <Twisty :open="row.expanded" />
          <span class="path">{{ row.label }}</span>
          <span class="count">{{ row.count }}</span>
          <button class="move" :title="folderMoveTitle" @click.stop="moveFolder(row.key)">
            {{ moveGlyph }}
          </button>
        </div>

        <div
          v-else
          class="row"
          :class="{ selected: isSelected(row.file!), primary: isPrimary(row.file!) }"
          :style="{ paddingLeft: `${row.depth * 12 + 8}px` }"
          :title="row.file!.path"
          @click="onRowClick(row.file!, $event)"
          @dblclick="move(row.file!)"
          @contextmenu.prevent="onRowContextMenu(row.file!, $event)"
        >
          <span class="letter" :class="`status-${row.file!.status}`">{{
            letterOf(row.file!)
          }}</span>
          <span class="path">
            <span v-if="row.dir" class="dir">{{ row.dir }}</span>{{ row.label }}
          </span>
          <span v-if="flagOf(row.file!)" class="flag" :title="flagTitle(row.file!)">{{
            flagOf(row.file!)
          }}</span>
          <!-- Right-aligned, so the counts read down the list as a column rather than trailing each name. -->
          <LineStats
            v-if="row.file!.lines"
            :added="addedOf(row.file!)"
            :deleted="deletedOf(row.file!)"
            column
          />
          <button class="move" :title="moveTitle" @click.stop="move(row.file!)">
            {{ moveGlyph }}
          </button>
        </div>
      </template>
    </div>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @run="onMenuCommand"
      @close="menu = null"
    />
  </section>
</template>

<style scoped src="@renderer/styles/listRow.css"></style>
<style scoped>
.staging-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  flex: 0 0 auto;
}

h3 {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  flex: 1;
}

/* How many rows an action would act on. Dim and lighter than the title: a fact about the moment, not part of the list's name. */
.picked {
  margin-left: var(--space-1);
  color: var(--fg-muted);
  font-weight: 400;
}

.filter {
  padding: var(--space-1) var(--space-2);
  flex: 0 0 auto;
}

.filter :deep(.filter-box) {
  width: 100%;
  font-size: var(--text-sm);
}

.rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.empty {
  padding: var(--space-2);
  margin: 0;
  color: var(--fg-muted);
  font-size: var(--text-sm);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 1px var(--space-2);
  font-size: var(--text-sm);
  cursor: default;
}

.count {
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

/* The directory part ahead of the name, dim: only drawn where indentation isn't saying it already. */
.flag {
  font-family: var(--font-mono);
  color: var(--warning);
  flex: 0 0 auto;
}

/* A wholly selected folder reads as one of the picked rows, not a dim heading that happens to be shaded. */
/* Which of several picked rows the diff pane is showing; without it, picking five files leaves no way to tell which one is on the right. */
.row.primary {
  box-shadow: inset 2px 0 0 var(--accent);
}

/*
 * The status letter, in the colour of what it says happened. Not part of the filename
 * and must not read as though it were: at the fg colour `M src/main.css` looked like
 * one string beginning with a stray letter.
 */
.letter {
  font-family: var(--font-mono);
  width: 1.2em;
  text-align: center;
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--fg-muted);
}

.status-added,
.status-untracked,
.status-copied {
  color: var(--success);
}

.status-modified,
.status-typechange {
  color: var(--warning);
}

/* A move, which is neither a change to the contents nor a new file. */
.status-renamed {
  color: var(--accent);
}

.status-deleted,
.status-conflicted {
  color: var(--danger);
}

/* No `direction: rtl` here, tempting as it is for keeping the filename visible: it moves a *leading* punctuation character to the visual end, so `.gitignore` draws as `gitignore.`. */
.path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Hidden until the row is under the pointer: a column of arrows down the whole list reads as decoration, and the double-click does the same thing. */
.move {
  flex: 0 0 auto;
  visibility: hidden;
  padding: 0 var(--space-1);
  border: none;
  background: none;
  color: var(--fg-muted);
}

.row:hover .move,
.row.selected .move {
  visibility: visible;
}

.move:hover {
  color: var(--fg);
}
</style>
