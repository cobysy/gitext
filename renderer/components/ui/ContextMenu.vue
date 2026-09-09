<script setup lang="ts">
/**
 * A context menu, rendered from resolved registry items. Recursive: a submenu is this
 * same component nested. HTML rather than Electron's native `Menu.popup`: themed from
 * `tokens.css` with everything else, and a native popup can't be screenshotted for
 * verification. Disabled rows are focusable by mouse but skipped by the arrow keys.
 */

import { computed, nextTick, ref } from 'vue';
import { KEY_ARROW_DOWN, KEY_ARROW_LEFT, KEY_ARROW_RIGHT, KEY_ARROW_UP, KEY_END, KEY_ENTER, KEY_ESCAPE, KEY_HOME, KEY_SPACE, formatAccelerator } from '@renderer/keys.js';
import type { ResolvedCommand, ResolvedItem, ResolvedSubmenu } from '@renderer/menus/resolve.js';
import { useMenuPlacement } from './useMenuPlacement.js';

const props = withDefaults(
  defineProps<{
    items: ResolvedItem[];
    /** Viewport coordinates the top-left corner wants. */
    x?: number;
    y?: number;
    /** Where to put the right edge instead, when the panel doesn't fit rightwards. A submenu passes its parent row's left edge, so it folds back across the row. */
    flipX?: number;
    /** A nested panel closes differently: it does not own the outside-click. */
    nested?: boolean;
  }>(),
  { x: 0, y: 0, flipX: undefined, nested: false }
);

const emit = defineEmits<{
  /** The row clicked: its command id, and the operand it named, if it named one. Surfaces whose rows are all declarations ignore the second argument. */
  run: [id: string, options?: unknown];
  close: [];
  /** Left-arrow out of a nested panel: the parent closes it and takes focus back. */
  back: [];
}>();

const ITEM_KIND_COMMAND = 'command';
const ITEM_KIND_SUBMENU = 'submenu';
const ITEM_KIND_SEPARATOR = 'separator';

const panel = ref<HTMLElement | null>(null);
/** Whether this panel reserves a column for the tick. Per panel, not per row: a tick indenting only its own row would ripple the left edge as state changed. */
const hasChecks = computed(() =>
  props.items.some((entry) => entry.kind === ITEM_KIND_COMMAND && entry.checked !== undefined)
);
const activeIndex = ref(-1);
const openIndex = ref(-1);
/** Viewport anchor for the open submenu, measured from its row. */
const openAnchor = ref({ x: 0, y: 0, flipX: 0 });

/** Staying on screen, and closing when a click, a scroll, or Escape says to. */
const { style } = useMenuPlacement({
  panel,
  x: () => props.x,
  y: () => props.y,
  flipX: () => props.flipX,
  nested: () => props.nested,
  onClose: () => emit('close')
});

/** A type guard, so the callers narrow past the separator without a second check. */
function isSelectable(item: ResolvedItem): item is ResolvedCommand | ResolvedSubmenu
{
  return item.kind !== ITEM_KIND_SEPARATOR && item.enabled;
}

/** Move the highlight by `delta`, skipping separators and disabled rows, wrapping. */
function step(delta: number): void
{
  const count = props.items.length;
  if (count === 0)
  {
    return;
  }

  // With nothing highlighted, Down starts at the top and Up at the bottom.
  let from;
  if (activeIndex.value < 0)
  {
    if (delta > 0)
    {
      from = -1;
    }
    else
    {
      from = count;
    }
  }
  else
  {
    from = activeIndex.value;
  }

  for (let i = 1; i <= count; i++)
  {
    const next = (((from + delta * i) % count) + count) % count;
    const item = props.items[next];
    if (item && isSelectable(item))
    {
      activeIndex.value = next;
      openIndex.value = -1;
      return;
    }
  }
}

/** Anchor a submenu to its row. Read from the DOM, not tracked: the row's position depends on how far the panel has scrolled, the case this exists for. */
function anchorTo(index: number): void
{
  const row = panel.value?.querySelector<HTMLElement>(`:scope > [data-index="${index}"]`);
  if (!row)
  {
    return;
  }
  const rect = row.getBoundingClientRect();
  openAnchor.value = { x: rect.right, y: rect.top - 4, flipX: rect.left };
  openIndex.value = index;
}

function openSubmenu(index: number, focusIt: boolean): void
{
  anchorTo(index);
  if (!focusIt)
  {
    return;
  }
  // Give the nested panel the keyboard, so arrow keys keep working downwards.
  void nextTick(() =>
  {
    panel.value?.querySelector<HTMLElement>('.menu')?.focus();
  });
}

function activate(index: number): void
{
  const item = props.items[index];
  if (!item || !isSelectable(item))
  {
    return;
  }

  if (item.kind === ITEM_KIND_SUBMENU)
  {
    activeIndex.value = index;
    openSubmenu(index, true);
    return;
  }

  emit('run', item.id, item.options);
}

function onEnterRow(index: number): void
{
  const item = props.items[index];
  if (!item || item.kind === ITEM_KIND_SEPARATOR)
  {
    return;
  }
  activeIndex.value = index;
  // Hovering a different row closes whatever submenu was open, even a disabled one: otherwise the old panel hangs over the new highlight.
  if (item.kind === ITEM_KIND_SUBMENU && item.enabled)
  {
    openSubmenu(index, false);
  }
  else
  {
    openIndex.value = -1;
  }
}

function onKeydown(event: KeyboardEvent): void
{
  switch (event.key)
  {
    case KEY_ARROW_DOWN:
      step(1);
      break;
    case KEY_ARROW_UP:
      step(-1);
      break;
    case KEY_ARROW_RIGHT: {
      const item = props.items[activeIndex.value];
      if (item?.kind === ITEM_KIND_SUBMENU && item.enabled)
      {
        activate(activeIndex.value);
      }
      else
      {
        return;
      }
      break;
    }
    case KEY_ARROW_LEFT:
      if (!props.nested)
      {
        return;
      }
      emit('back');
      break;
    case KEY_HOME:
      activeIndex.value = -1;
      step(1);
      break;
    case KEY_END:
      activeIndex.value = props.items.length;
      step(-1);
      break;
    case KEY_ENTER:
    case KEY_SPACE:
      activate(activeIndex.value);
      break;
    case KEY_ESCAPE:
      emit('close');
      break;
    default:
      return;
  }
  // Only reached when the key was one of ours: a menu must not let Escape or the arrows fall through to the grid underneath it.
  event.preventDefault();
  event.stopPropagation();
}

/** Close a nested panel and take the keyboard back. */
function onChildBack(): void
{
  openIndex.value = -1;
  panel.value?.focus();
}
</script>

<template>
  <div
    ref="panel"
    class="menu"
    :class="{ nested }"
    :style="style"
    tabindex="-1"
    role="menu"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <template v-for="(entry, index) in items" :key="index">
      <div v-if="entry.kind === ITEM_KIND_SEPARATOR" class="separator" role="separator" />

      <div
        v-else
        class="row"
        :class="{ active: activeIndex === index, disabled: !entry.enabled }"
        role="menuitem"
        :data-index="index"
        :aria-disabled="!entry.enabled"
        :aria-checked="entry.kind === ITEM_KIND_COMMAND && entry.checked !== undefined ? entry.checked : undefined"
        @mouseenter="onEnterRow(index)"
        @click="activate(index)"
      >
        <span v-if="hasChecks" class="check" aria-hidden="true">
          <template v-if="entry.kind === ITEM_KIND_COMMAND && entry.checked">✓</template>
        </span>

        <span class="label">{{ entry.label }}</span>

        <span v-if="entry.kind === ITEM_KIND_SUBMENU" class="chevron">›</span>
        <span v-else-if="entry.accelerator" class="accelerator">
          {{ formatAccelerator(entry.accelerator) }}
        </span>

        <ContextMenu
          v-if="entry.kind === ITEM_KIND_SUBMENU && openIndex === index"
          nested
          :items="entry.items"
          :x="openAnchor.x"
          :y="openAnchor.y"
          :flip-x="openAnchor.flipX"
          @run="(id, options) => emit('run', id, options)"
          @close="emit('close')"
          @back="onChildBack"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.menu {
  z-index: 100;
  min-width: 220px;
  max-width: 380px;
  /* A left-panel node's menu can outgrow even a small window. It scrolls rather than being clipped; submenus are `position: fixed`, so they escape this. */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: var(--space-1) 0;
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  font-size: var(--text-sm);
  user-select: none;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 3px var(--space-3);
  white-space: nowrap;
  cursor: default;
}

.row.active {
  background: var(--bg-selected);
}

.row.disabled {
  color: var(--fg-subtle);
}

/* Greyed rows must not also light up on hover: the highlight would read as clickable. */
.row.disabled.active {
  background: transparent;
}

/* Fixed width, holding the column open whether or not this row is ticked: see `hasChecks`. Its own smaller gap: a tick belongs to the label beside it. */
.check {
  flex: none;
  width: 12px;
  margin-right: calc(var(--space-2) - var(--space-3));
  text-align: center;
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.accelerator,
.chevron {
  flex: none;
  color: var(--fg-subtle);
  font-size: var(--text-xs);
}

.row.active:not(.disabled) .accelerator,
.row.active:not(.disabled) .chevron {
  color: inherit;
}

.separator {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--border);
}
</style>
