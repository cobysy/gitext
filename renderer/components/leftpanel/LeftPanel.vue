<script setup lang="ts">
/**
 * Left panel: repository objects as a virtualized tree. Clicking refs moves grid selection.
 */

import { computed, nextTick, ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useContextMenu } from '@renderer/composables/useContextMenu.js';
import { menuFor, panelBackgroundMenu, panelSortMenu } from '@renderer/menus/leftPanel.js';
import { resolveMenu } from '@renderer/menus/resolve.js';
import type { FlatNode } from '@renderer/panel.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { TOAST_TONE_INFO, useUiStore } from '@renderer/stores/ui.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import FilterBox from '@renderer/components/ui/FilterBox.vue';
import NodeIcon from './NodeIcon.vue';
import { ROW_HEIGHT, usePanelActivation } from './usePanelActivation.js';
import { KEY_ARROW_DOWN } from '@renderer/keys.js';
import Twisty from '@renderer/components/ui/Twisty.vue';

const objects = useRepoObjectsStore();
const ui = useUiStore();
const commandContext = useCommandContext();

const NODE_KIND_SECTION = 'section';

const OVERSCAN = 10;
/** Indent per level. One level is the twisty's width, so children line up under it. */
const INDENT = 14;

const scroller = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

const rows = computed<FlatNode[]>(() => objects.rows);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN
  }))
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalHeight = computed(() => virtualizer.value.getTotalSize());

const activeIndex = computed(() =>
  rows.value.findIndex((row) => row.node.id === objects.selectedId)
);

/** Selecting and activating a node, by click or by keyboard. */
const { onRowClick, onRowDoubleClick, rowTitle, onTwistyClick, move, onKeydown } =
  usePanelActivation({
    rows: () => rows.value,
    activeIndex: () => activeIndex.value,
    scroller,
    panel
  });

// ── Context menu ─────────────────────────────────────────────────────────────

const { menu, openAt, openBelow, openFrom, close: closeMenu } = useContextMenu();
/** Where the keyboard goes when the menu closes; the rows, unless a control opened it. */
let menuReturnFocus: HTMLElement | null = null;

/**
 * The row's own menu button.
 *
 * The panel's menus are the richest surface in the app, and until this button nothing on
 * screen said so: rename, set upstream, delete a remote branch, every `remoteBranch.fetch*`
 * and all four stash actions were reachable only by guessing that right-click did something.
 * Same menu, same code path, anchored under the button rather than at the pointer.
 */
function onRowMenuClick(row: FlatNode, event: MouseEvent): void
{
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement;
  menuReturnFocus = button;
  objects.select(row.node.id);
  void nextTick(() =>
  {
    openBelow(button, resolveMenu(menuFor(row.node.kind, row.node.id), commandContext.value));
  });
}

function onRowContextMenu(row: FlatNode, event: MouseEvent): void
{
  event.preventDefault();
  menuReturnFocus = null;
  // The menu acts on the panel's selection, so the right-clicked row becomes it
  // first: otherwise every item would be about whatever was selected before.
  objects.select(row.node.id);
  // Resolved after the selection has changed, so the predicates see this node.
  void nextTick(() =>
  {
    openFrom(event, resolveMenu(menuFor(row.node.kind, row.node.id), commandContext.value));
  });
}

/**
 * The sort button's menu, opened under the button rather than at the pointer.
 *
 * Anchored to the button's bottom-left so it reads as belonging to it: a menu that
 * appeared wherever the click landed would look like a context menu that had lost its
 * row. `ContextMenu` clamps and flips it if the panel is too narrow to hold it.
 */
function onSortClick(event: MouseEvent): void
{
  const button = event.currentTarget as HTMLElement;
  const box = button.getBoundingClientRect();
  // Closing returns the keyboard to the button, not to the tree: this menu was opened
  // from a control, and a context menu's rule, go back to the rows, would strand
  // someone who tabbed here and pressed Escape.
  menuReturnFocus = button;
  openAt(box.left, box.bottom + 2, resolveMenu(panelSortMenu, commandContext.value));
}

function onBackgroundContextMenu(event: MouseEvent): void
{
  event.preventDefault();
  menuReturnFocus = null;
  openFrom(event, resolveMenu(panelBackgroundMenu, commandContext.value));
}

function onCloseMenu(): void
{
  closeMenu();
  const target = menuReturnFocus ?? panel.value;
  menuReturnFocus = null;
  target?.focus();
}

async function onMenuCommand(id: string): Promise<void>
{
  onCloseMenu();
  const ran = await runCommand(id, commandContext.value);
  if (!ran)
  {
    ui.toast(`"${id}" is not available yet.`, TOAST_TONE_INFO);
  }
}

// ── Filter ───────────────────────────────────────────────────────────────────

function onFilterKeydown(event: KeyboardEvent): void
{
  // Escape is the box's own: `FilterBox` clears itself and never forwards it here.
  // Down out of the box moves into the rows, so a search can be walked from the
  // keyboard without reaching for the mouse.
  if (event.key === KEY_ARROW_DOWN)
  {
    panel.value?.focus();
    let step: number;
    if (activeIndex.value === -1)
    {
      step = 0;
    }
    else
    {
      step = 1;
    }
    move(step);
    event.preventDefault();
  }
}
</script>

<template>
  <div ref="panel" class="left-panel" tabindex="0" @keydown="onKeydown" @focusin="ui.focusPane('leftPanel')">
    <div class="filter">
      <FilterBox
        v-model="objects.filter"
        class="search"
        @keydown="onFilterKeydown"
      />

      <!-- The title names what is sorted. "Sort" alone does not say whether it means
           the sections, the branches inside them, or the commits in the grid. -->
      <button
        class="sort"
        type="button"
        title="Sort branches, tags and remotes"
        aria-label="Sort branches, tags and remotes"
        aria-haspopup="menu"
        @click="onSortClick"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <!-- Three bars, longest to shortest: an ordered list, not a direction. -->
            <path d="M2.5 4h11M2.5 8h7.5M2.5 12h4" />
          </g>
        </svg>
      </button>
    </div>

    <div ref="scroller" class="scroller" @contextmenu.self="onBackgroundContextMenu">
      <div class="sizer" :style="{ height: `${totalHeight}px` }">
        <div
          v-for="virtualRow in virtualRows"
          :key="rows[virtualRow.index]?.node.id ?? virtualRow.index"
          class="row"
          :class="{
            selected: rows[virtualRow.index]?.node.id === objects.selectedId,
            section: rows[virtualRow.index]?.node.kind === NODE_KIND_SECTION,
            current: rows[virtualRow.index]?.node.isCurrent,
            stale: rows[virtualRow.index]?.node.isStale,
            disabled: rows[virtualRow.index]?.node.isDisabled
          }"
          :style="{
            transform: `translateY(${virtualRow.start}px)`,
            paddingLeft: `${4 + (rows[virtualRow.index]?.depth ?? 0) * INDENT}px`
          }"
          :title="rowTitle(rows[virtualRow.index])"
          @click="rows[virtualRow.index] && onRowClick(rows[virtualRow.index]!, $event)"
          @dblclick="rows[virtualRow.index] && onRowDoubleClick(rows[virtualRow.index]!)"
          @contextmenu="
            rows[virtualRow.index] && onRowContextMenu(rows[virtualRow.index]!, $event)
          "
        >
          <Twisty
            :open="rows[virtualRow.index]?.expanded"
            :expandable="rows[virtualRow.index]?.expandable"
            @click="rows[virtualRow.index] && onTwistyClick(rows[virtualRow.index]!, $event)"
          />

          <NodeIcon
            v-if="rows[virtualRow.index] && rows[virtualRow.index]!.node.kind !== NODE_KIND_SECTION"
            :kind="rows[virtualRow.index]!.node.kind"
            :merged="rows[virtualRow.index]!.node.isMerged"
          />

          <span class="label">{{ rows[virtualRow.index]?.node.label }}</span>

          <span v-if="rows[virtualRow.index]?.node.detail" class="detail">
            {{ rows[virtualRow.index]?.node.detail }}
          </span>

          <button
            v-if="rows[virtualRow.index]"
            class="rowmenu"
            tabindex="-1"
            aria-haspopup="menu"
            :aria-label="`What ${rows[virtualRow.index]!.node.label} can do`"
            @click="onRowMenuClick(rows[virtualRow.index]!, $event)"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <g fill="currentColor">
                <circle cx="3.5" cy="8" r="1.3" />
                <circle cx="8" cy="8" r="1.3" />
                <circle cx="12.5" cy="8" r="1.3" />
              </g>
            </svg>
          </button>
        </div>
      </div>

      <p v-if="objects.error" class="message error">{{ objects.error }}</p>
      <p v-else-if="rows.length === 0 && objects.filter" class="message">No matches</p>
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
.left-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--bg-subtle);
  border-right: 1px solid var(--border);
  font-size: var(--text-sm);
  outline: none;
}

.filter {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

/* The box takes what the sort button leaves; `FilterBox` draws the rest. */
.search {
  flex: 1;
}

/* Square, matching the input's height, so the row reads as one control strip. */
.sort {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: default;
}

.sort:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.scroller {
  flex: 1;
  overflow: auto;
  contain: strict;
}

.row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 22px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-right: var(--space-2);
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.row.section {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-muted);
}

/* The checked-out branch, and the worktree this window has open.
   Bold is not enough on its own: the section headers are bold too, and the one row that
   matters most is the one you should find without reading. A dashed accent box says
   "you are here" at a glance. Not a focus ring: this app draws none; it marks a fact
   about the repository and stays put while the keyboard moves. */
.row.current {
  outline: 1px dashed var(--accent);
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}

.row.current .label {
  font-weight: 600;
}

.row.current .icon {
  color: var(--accent);
}

.row.stale .label,
.row.stale .detail {
  color: var(--fg-subtle);
}

/* A deactivated remote. Dimmed all through, icon included: the row is still readable
   and still has its whole menu, it just is not one of the remotes in play. */
.row.disabled .label,
.row.disabled .detail,
.row.disabled .icon {
  color: var(--fg-subtle);
}

/* Quieter than the row's own text: the chevron places a section, it does not name it. */
.twisty {
  color: var(--fg-subtle);
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * On the row under the pointer and on the selected one, over the row's right edge rather
 * than in its layout. In the flow it would cost every row 18px of name for a control shown
 * on one at a time, and this panel is the narrowest thing in the window: `phase0-guardrails`
 * lost four more characters to it. Absolute, so it costs nothing and nothing reflows when
 * the pointer arrives. It takes the row's own background, since the only rows that show it
 * are the hovered and the selected one.
 */
.rowmenu {
  display: none;
  position: absolute;
  right: var(--space-1);
  top: 2px;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--fg-muted);
}

.row:hover .rowmenu {
  display: flex;
  background: var(--bg-hover);
}

.row.selected .rowmenu {
  display: flex;
  background: var(--bg-selected);
}

.rowmenu:hover {
  background: var(--bg-active);
  color: var(--fg);
}

.detail {
  margin-left: auto;
  padding-left: var(--space-2);
  color: var(--fg-subtle);
  font-size: var(--text-xs);
  /* The name matters more than its annotation: the URL or the divergence gives way
     first when the panel is narrow. */
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}

.message {
  margin: var(--space-3);
  color: var(--fg-muted);
}

.message.error {
  color: var(--danger);
}
</style>
