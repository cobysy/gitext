<script setup lang="ts">
/**
 * The revision grid.
 *
 * Virtualized, because the target is a 50k-commit history and only ~40 rows are ever
 * on screen. Rows are DOM (so text selects, wraps, and reads to a screen reader);
 * only the lane graph is canvas.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  artificialKind,
  countChanges,
  describeChanges,
  filesFor,
  isArtificialSha
} from '@shared/artificial.js';
import {
  COLUMN_AUTHOR,
  COLUMN_DATE,
  COLUMN_GRAPH,
  COLUMN_LABELS,
  COLUMN_MESSAGE,
  COLUMN_SHA,
  isMovable,
  isResizable
} from '@renderer/columns.js';
import {
  describeCommitDates,
  formatAuthorName,
  formatCommitDate,
  gridCommitDate,
  inlineBody,
  shortSha
} from '@renderer/format.js';
import { markRelative } from '@renderer/model/graph/index.js';
import { GRAPH_DIM_ALL } from '@shared/types.js';
import { useQuickSearchStore } from '@renderer/stores/quickSearch.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import RefChip from '@renderer/components/ui/RefChip.vue';
import GraphCanvas from './GraphCanvas.vue';
import { useColumnLayout } from './useColumnLayout.js';
import { useGraphProps } from './useGraphProps.js';
import { ROW_HEIGHT, useGridInteraction } from './useGridInteraction.js';

const repo = useRepoStore();
const revisions = useRevisionsStore();
const selection = useSelectionStore();
const settings = useSettingsStore();
const ui = useUiStore();
// Read directly here too (not only inside `useGridInteraction`), for the quick-search indicator below, a template-only concern.
const quickSearch = useQuickSearchStore();

/** Rows drawn beyond the viewport, so scrolling does not reveal blank space. */
const OVERSCAN = 12;

const scroller = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: revisions.rows.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN
  }))
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalHeight = computed(() => virtualizer.value.getTotalSize());

/** First and last row the canvas has to draw. */
const range = computed(() =>
{
  const items = virtualRows.value;
  if (items.length === 0)
  {
    return { start: 0, end: 0 };
  }
  return { start: items[0]!.index, end: items[items.length - 1]!.index + 1 };
});

const graphOffset = computed(() => (virtualRows.value[0]?.start ?? 0));

/** Hidden, and only ever read from: one real cell per column, in the real font. */
const probe = ref<HTMLElement | null>(null);

const {
  shownColumns,
  graphVisible,
  template,
  remeasure,
  dragging,
  dropBefore,
  onResizeStart,
  onResizeReset,
  onHeaderDragStart,
  onHeaderDragOver,
  onHeaderDrop,
  onHeaderDragEnd
} = useColumnLayout({
  gridColumns: () => settings.settings.gridColumns,
  persist: (next) => void settings.patch({ gridColumns: next }),
  authorInitials: () => settings.settings.authorInitials,
  dateFormat: () => settings.settings.dateFormat,
  showAuthorDate: () => settings.settings.showAuthorDate,
  rows: () => revisions.rows,
  range: () => range.value,
  widestLaneCount: () =>
  {
    let widest = 1;
    for (let i = range.value.start; i < range.value.end; i++)
    {
      const row = revisions.graph[i];
      if (row)
      {
        widest = Math.max(widest, row.laneCount);
      }
    }
    return widest;
  },
  headerEl,
  probeEl: probe
});

/** Scrolling and a batch landing both bring rows nobody has measured. A count that's *fallen* is a different history: a reload starts over rather than inheriting old widths. */
watch([range, () => revisions.rows.length], ([, count], [, before]) =>
  remeasure(count < before)
);

// All three of these change what a cell says, so every width measured from the old text
// is now a measurement of something that is no longer on screen.
watch(
  [
    () => settings.settings.authorInitials,
    () => settings.settings.dateFormat,
    () => settings.settings.showAuthorDate
  ],
  () => remeasure(true)
);

/**
 * Whether this row's text is drawn in the dimmed colour: the same ancestry marks the
 * lanes read, so the two halves can never disagree. `markRelative` treats the empty array as "everything is relative", the no-seed case: nothing dims.
 */
function isDimmed(index: number): boolean
{
  return (
    settings.settings.graphDimNonRelatives === GRAPH_DIM_ALL
    && !markRelative(revisions.relative, index)
  );
}

onMounted(() => remeasure(true));

/** What `GraphCanvas` needs, computed from the store. */
/**
 * The row a screen reader should announce as current.
 *
 * The scroller keeps focus, because the rows are virtualized and come and go, which makes
 * `aria-activedescendant` the only way to say which one is current. Without it the
 * listbox announced itself and then nothing at all: `role="listbox"` with no
 * `role="option"` under it is worse than no role, since it promises a list and delivers
 * an empty one.
 */
const activeRowId = computed(() =>
{
  const sha = selection.primary;
  if (!sha)
  {
    return undefined;
  }
  const index = revisions.rows.findIndex((row) => row.sha === sha);
  if (index < 0)
  {
    return undefined;
  }
  return `revision-row-${index}`;
});

const { selectedRows, rowsWithRefs, graphLineWidth, headRow } = useGraphProps({
  range: () => range.value,
  rows: () => revisions.rows,
  isSelected: (sha) => selection.has(sha),
  selectionCount: () => selection.count,
  head: () => repo.repo?.head,
  branch: () => repo.repo?.branch,
  rowOf: (sha) => revisions.rowOf(sha),
  lineWidth: () => settings.settings.graphLineWidth
});

/** What an artificial row shows instead of a subject: how many files it covers, read off the same `repo.status` the rows themselves were built from. */
function changeSummary(sha: string): string
{
  const kind = artificialKind(sha);
  const files = repo.status?.files;
  if (!kind || !files)
  {
    return '';
  }
  return describeChanges(countChanges(filesFor(kind, files)));
}

/** The mouse, the keyboard, the context menu, and keeping focus and scroll following selection. */
const { menu, onRowClick, onRowContextMenu, onCloseMenu, onMenuCommand, onKeydown, sortedRefs } =
  useGridInteraction({
    scroller,
    scrollToIndex: (row, align) => virtualizer.value.scrollToIndex(row, { align })
  });
</script>

<template>
  <div class="grid" @focusin="ui.focusPane('grid')">
    <div ref="headerEl" class="header" :style="{ gridTemplateColumns: template }">
      <span
        v-for="column in shownColumns"
        :key="column.id"
        class="head"
        :class="[
          `col-${column.id}`,
          {
            dragging: dragging === column.id,
            'drop-before': dropBefore === column.id,
            'drop-last': dropBefore === null && shownColumns[shownColumns.length - 1]!.id === column.id
          }
        ]"
        :draggable="isMovable(column.id)"
        @dragstart="onHeaderDragStart(column.id, $event)"
        @dragover="onHeaderDragOver(column.id, $event)"
        @drop="onHeaderDrop()"
        @dragend="onHeaderDragEnd()"
      >
        <!-- The graph column has no name worth printing: the lanes are self-evident. -->
        <span v-if="column.id !== COLUMN_GRAPH" class="head-label">
          {{ COLUMN_LABELS[column.id] }}
        </span>

        <span
          v-if="isResizable(column.id)"
          class="resize"
          title="Drag to resize · double-click to fit the contents"
          @pointerdown="onResizeStart(column.id, $event)"
          @dblclick="onResizeReset(column.id)"
        />
      </span>
    </div>

    <!-- Never seen, only read by `remeasure`: one empty cell per measured column, carrying the same classes a real row's cells do, so the font is read from the stylesheet rather than a constant that could drift. -->
    <div ref="probe" class="row probe" aria-hidden="true">
      <span class="col-author" />
      <span class="col-date" />
      <span class="col-sha" />
    </div>

    <!-- Focusable: arrow keys and quick search belong to the grid, not the window, and a list that can't hold focus can't be typed into. -->
    <div
      ref="scroller"
      class="scroller"
      tabindex="0"
      role="listbox"
      aria-label="Revisions"
      :aria-activedescendant="activeRowId"
      @keydown="onKeydown"
      @scroll.passive="headerEl && (headerEl.style.transform = `translateX(${-($event.target as HTMLElement).scrollLeft}px)`)"
    >
      <div class="sizer" :style="{ height: `${totalHeight}px` }">
        <GraphCanvas
          v-if="graphVisible"
          class="graph-layer"
          :style="{ transform: `translateY(${graphOffset}px)` }"
          :rows="revisions.graph"
          :start="range.start"
          :end="range.end"
          :row-height="ROW_HEIGHT"
          :selected="selectedRows"
          :has-refs="rowsWithRefs"
          :line-width="graphLineWidth"
          :relative="revisions.relative"
          :head="headRow"
        />

        <template v-for="virtualRow in virtualRows" :key="virtualRow.index">
          <div
            v-if="revisions.rows[virtualRow.index]"
            :id="`revision-row-${virtualRow.index}`"
            class="row"
            role="option"
            :aria-selected="selectedRows.has(virtualRow.index)"
            :class="{
              selected: selectedRows.has(virtualRow.index),
              primary: selection.primary === revisions.rows[virtualRow.index]!.sha,
              artificial: isArtificialSha(revisions.rows[virtualRow.index]!.sha),
              dim: isDimmed(virtualRow.index)
            }"
            :style="{
              height: `${ROW_HEIGHT}px`,
              transform: `translateY(${virtualRow.start}px)`,
              gridTemplateColumns: template
            }"
            @click="onRowClick(virtualRow.index, $event)"
            @contextmenu="onRowContextMenu(virtualRow.index, $event)"
          >
            <!-- Cells follow the column order, not the markup order: reordering is a data change, not a template change. -->
            <template v-for="column in shownColumns" :key="column.id">
              <span v-if="column.id === COLUMN_GRAPH" class="col-graph" />

              <span v-else-if="column.id === COLUMN_MESSAGE" class="col-message">
                <RefChip
                  v-for="ref in sortedRefs(revisions.rows[virtualRow.index]!)"
                  :key="ref.name"
                  :kind="ref.kind"
                  :name="ref.name"
                  :current="ref.isCurrent"
                />
                <span class="subject">{{ revisions.rows[virtualRow.index]!.subject }}</span>

                <!-- The rest of the message, on the same line: the row is one line tall, and a grid whose rows grow with the commit can't be read down. -->
                <span
                  v-if="settings.settings.showMessageBody && revisions.rows[virtualRow.index]!.body"
                  class="body"
                >{{ inlineBody(revisions.rows[virtualRow.index]!.body) }}</span>

                <!-- Artificial rows have no message, so the file count takes its place. -->
                <span
                  v-if="isArtificialSha(revisions.rows[virtualRow.index]!.sha)"
                  class="changes"
                >{{ changeSummary(revisions.rows[virtualRow.index]!.sha) }}</span>
                <span
                  v-else-if="revisions.rows[virtualRow.index]!.body"
                  class="has-body"
                  title="This commit has a message body"
                >…</span>
              </span>

              <!-- An artificial row has no author, date, or SHA: not a commit yet. A hyphen says that; a blank cell reads as a bug. -->
              <span
                v-else-if="isArtificialSha(revisions.rows[virtualRow.index]!.sha)"
                class="none"
                :class="`col-${column.id}`"
              >-</span>

              <span
                v-else-if="column.id === COLUMN_AUTHOR"
                class="col-author"
                :title="settings.settings.authorInitials ? revisions.rows[virtualRow.index]!.authorName : undefined"
              >{{ formatAuthorName(revisions.rows[virtualRow.index]!.authorName, revisions.rows[virtualRow.index]!.authorEmail, settings.settings.authorInitials) }}</span>
              <span
                v-else-if="column.id === COLUMN_DATE"
                class="col-date"
                :title="describeCommitDates(revisions.rows[virtualRow.index]!)"
              >
                {{
                  formatCommitDate(
                    gridCommitDate(
                      revisions.rows[virtualRow.index]!,
                      settings.settings.showAuthorDate
                    ),
                    settings.settings.dateFormat
                  )
                }}
              </span>
              <span v-else-if="column.id === COLUMN_SHA" class="col-sha">
                {{ shortSha(revisions.rows[virtualRow.index]!.sha) }}
              </span>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- Outside the scroller: it must not scroll away with the rows, and `contain: strict` on the scroller would clip it anyway. -->
    <div v-if="quickSearch.active" class="quick-search" :class="{ missing: !quickSearch.found }">
      Searching for: {{ quickSearch.term }}
    </div>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @run="onMenuCommand"
      @close="onCloseMenu"
    />

  </div>
</template>

<style scoped src="@renderer/styles/listRow.css"></style>
<style scoped>
.grid {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* `grid-template-columns` is set inline from one `gridTemplate` call, so the header and the rows can't drift out of alignment. */
.header,
.row {
  display: grid;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  white-space: nowrap;
}

.header {
  flex: none;
  height: 26px;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* The header translates horizontally with scroll, so its border-bottom would move too and leave a gap. Draw the line on .grid instead: it stays fixed at the header height. */
.grid::after {
  content: '';
  position: absolute;
  top: 26px;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border);
  pointer-events: none;
}

.head {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 100%;
}

.head-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.head.dragging {
  opacity: 0.4;
}

/* Where the dragged column would land. Drawn on the hovered header, not a floating line, so it can't end up pointing between two columns that moved. */
.head.drop-before::before,
.head.drop-last::after {
  content: '';
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--accent);
}

.head.drop-before::before {
  left: calc(var(--space-1) * -1);
}

.head.drop-last::after {
  right: calc(var(--space-1) * -1);
}

/* Inside its own column, flush against the right edge, not centred on the gap outside it: a header cell that clips its overflow swallows a handle that hangs out. */
.resize {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}

.resize:hover::after {
  content: '';
  position: absolute;
  right: 0;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: var(--accent);
}

/* No focus ring around the pane: the selected row already says where the arrow keys go. */
.scroller {
  flex: 1;
  overflow: auto;
  min-height: 0;
  contain: strict;
  outline: none;
}

.quick-search {
  position: absolute;
  left: var(--space-2);
  top: 34px;
  z-index: 3;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

/* A term that matches nothing still shows, so finding nothing is distinguishable from the keystrokes not arriving at all. */
.quick-search.missing {
  border-color: var(--danger);
  color: var(--danger);
}

.graph-layer {
  position: absolute;
  top: 0;
  left: var(--space-2);
  z-index: 1;
}

.row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  font-size: var(--text-sm);
  cursor: default;
}

/* `listRow.css` covers hover and selected backgrounds; this row also resets the text colour on hover, since the virtualized rows inherit colour `.row:hover` alone won't touch. */
.row:hover {
  color: inherit;
}

/* With several rows selected, mark the one the details pane is describing. */
.row.selected.primary {
  box-shadow: inset 2px 0 0 var(--accent);
}

/* Out of the layout and the accessibility tree, but still styled: the measurer reads the computed font off these cells. `display: none` would leave it nothing to read. */
.probe {
  top: -9999px;
  visibility: hidden;
  pointer-events: none;
}

/* Row cells only. The header cells carry the same `col-*` classes so the drop indicator can find them, but they're laid out by `.head`, not by these. */
.row .col-message {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  overflow: hidden;
}

.subject {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Dimmer than the subject, so one glance still lands on the commit's own name. `flex: 1
   1 0`, not the default `0 1 auto`: a zero basis takes the body out of the shrink
   calculation, so it fills what's left after the subject rather than shrinking the subject to three characters (shrink is proportional to length, and a body is far longer). */
.body {
  flex: 1 1 0;
  color: var(--fg-subtle);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Drawn whether or not the body is: it says there is more here, not that it's hidden. */
.has-body {
  color: var(--fg-subtle);
  flex: none;
}

/* A row off the highlighted ancestry, when `graphDimNonRelatives` is `all`: the
   statement the dimmed lanes already make, carried into the text beside them. The
   selected row keeps its own colour: dimming it over the selection background would leave it the hardest line to read. */
.row.dim:not(.selected) .subject,
.row.dim:not(.selected) .col-author,
.row.dim:not(.selected) .col-date,
.row.dim:not(.selected) .col-sha {
  color: var(--fg-subtle);
}

/* The working-tree and index rows are not commits, and should not read as one. */
.row.artificial .subject {
  font-style: italic;
  color: var(--fg-muted);
}

.changes {
  flex: none;
  color: var(--fg-subtle);
  font-size: var(--text-xs);
}

.none {
  color: var(--fg-subtle);
}

.row .col-author,
.row .col-date {
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.row .col-sha {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The ref chip itself is `RefChip.vue`: the grid's role is just to place it. */

</style>
