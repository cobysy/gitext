<script setup lang="ts">
/**
 * The main toolbar (§6).
 *
 * A rendering of the command registry, like every other surface: the row of buttons is
 * `mainToolbar`'s list of ids resolved against it, so a button's name is the registry's
 * label and it can never offer an action the registry does not have. Commands a
 * later phase will build draw greyed, the same as in the menus: the toolbar's shape is
 * muscle memory and must not move as phases land.
 *
 * The dropdown opens the shared `ContextMenu`, so a menu opened from the toolbar
 * behaves like a menu opened anywhere else, keyboard included.
 */

import { computed, ref } from 'vue';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { mainToolbar, resolveToolbar } from '@renderer/menus/toolbar.js';
import type { ResolvedItem } from '@renderer/menus/resolve.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { REF_KIND_BRANCH, TOOLBAR_LABELS_NONE } from '@shared/types.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { TOAST_TONE_INFO, useUiStore } from '@renderer/stores/ui.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import ToolbarIcon from './ToolbarIcon.vue';
import RepoSwitcher from './RepoSwitcher.vue';

const repoStore = useRepoStore();
const objects = useRepoObjectsStore();
const ui = useUiStore();
const settings = useSettingsStore();
const commandContext = useCommandContext();

const ITEM_KIND_SEPARATOR = 'separator';
const ITEM_KIND_BUTTON = 'button';
/** Enough of a SHA to tell two apart at a glance, matching what `RepoSwitcher` shows. */
const SHORT_SHA_LENGTH = 8;

/** The local branches, which is what the branch button's list is made of. */
const localBranches = computed(() =>
  objects.refs.filter((entry) => entry.kind === REF_KIND_BRANCH)
);

const items = computed(() =>
  resolveToolbar(mainToolbar(localBranches.value), commandContext.value)
);
const changedCount = computed(() => repoStore.changedFileCount);
/**
 * Whether the buttons are named. All of them or none of them: a row where three carry a
 * word and seven do not reads as seven buttons whose label went missing, and which three
 * are named is a guess about what someone else does most.
 */
const showLabels = computed(() => settings.settings.toolbarLabels !== TOOLBAR_LABELS_NONE);

/**
 * What the branch dropdown is called: the branch you are on, or what stands in for one.
 * The same three answers `RepoSwitcher` gives, since a detached HEAD and a repository with
 * no commits are the two cases where there is no name to show.
 */
const branchLabel = computed(() =>
{
  const repo = repoStore.repo;
  if (repo?.branch)
  {
    return repo.branch;
  }
  if (repo?.head)
  {
    return repo.head.slice(0, SHORT_SHA_LENGTH);
  }
  return '(no commits)';
});

/** A dropdown's drawn label: the repository's own for the branch button, the constant otherwise. */
function dropdownLabel(entry: { label: string; dynamicLabel: boolean }): string
{
  if (entry.dynamicLabel)
  {
    return branchLabel.value;
  }
  return entry.label;
}

const menu = ref<{ x: number; y: number; items: ResolvedItem[] } | null>(null);
/** The button the menu was opened from, so Escape gives the keyboard back to it. */
let menuReturnFocus: HTMLElement | null = null;

/** Label plus accelerator, since the button itself shows neither. */
function tooltip(label: string, accelerator?: string): string
{
  if (accelerator)
  {
    return `${label} (${accelerator})`;
  }
  else
  {
    return label;
  }
}

/** `options` is the operand a row named: the branch list's rows each carry their own ref. */
async function run(id: string, options?: unknown): Promise<void>
{
  const ran = await runCommand(id, commandContext.value, options);
  if (!ran)
  {
    ui.toast(`"${id}" is not available yet.`, TOAST_TONE_INFO);
  }
}

function openDropdown(event: MouseEvent, dropdownItems: ResolvedItem[]): void
{
  const button = event.currentTarget as HTMLElement;
  const box = button.getBoundingClientRect();
  menuReturnFocus = button;
  // Anchored under the button rather than at the pointer: it belongs to the button.
  menu.value = { x: box.left, y: box.bottom + 2, items: dropdownItems };
}

function closeMenu(): void
{
  menu.value = null;
  const target = menuReturnFocus;
  menuReturnFocus = null;
  target?.focus();
}

async function onMenuCommand(id: string, options?: unknown): Promise<void>
{
  closeMenu();
  await run(id, options);
}
</script>

<template>
  <div class="toolbar">
    <RepoSwitcher />

    <div class="divider" />

    <template v-for="(entry, index) in items" :key="index">
      <div v-if="entry.kind === ITEM_KIND_SEPARATOR" class="divider" />

      <button
        v-else-if="entry.kind === ITEM_KIND_BUTTON"
        class="tool"
        :class="{ badged: entry.badge && changedCount > 0 }"
        :disabled="!entry.enabled"
        :title="tooltip(entry.label, entry.accelerator)"
        :aria-label="entry.label"
        @click="run(entry.id)"
      >
        <ToolbarIcon :id="entry.id" />
        <span v-if="showLabels" class="label">{{ entry.label }}</span>
        <span v-if="entry.badge && changedCount > 0" class="badge">{{ changedCount }}</span>
      </button>

      <button
        v-else
        class="tool"
        :disabled="!entry.enabled"
        :title="entry.label"
        :aria-label="entry.label"
        aria-haspopup="menu"
        @click="openDropdown($event, entry.items)"
      >
        <!-- No glyph for the branch button: it is named after what it points at, the way
             the repository switcher beside it is, and `ToolbarIcon` has no shape for an id
             that is not a command. -->
        <span v-if="entry.dynamicLabel" class="label branch truncate">
          {{ dropdownLabel(entry) }}
        </span>
        <template v-else>
          <ToolbarIcon :id="entry.id" />
          <span v-if="showLabels" class="label">{{ entry.label }}</span>
        </template>
        <svg class="caret" viewBox="0 0 8 5" width="7" height="5" aria-hidden="true">
          <path d="M0.8 1 4 4.2 7.2 1" fill="none" stroke="currentColor" stroke-width="1.3"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </template>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @run="onMenuCommand"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  /* Wraps rather than clips: with every button named the row outgrows a narrow window,
     and a toolbar that hides the last three actions hides them without saying so. */
  flex-wrap: wrap;
  gap: 2px;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-subtle);
}

.divider {
  flex: none;
  width: 1px;
  height: 18px;
  /* Enough to read as a group boundary, and no more: with every button named, the row is
     within about twenty pixels of the default window's width. */
  margin: 0 var(--space-1);
  background: var(--border);
}

.tool {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--fg);
}

.tool:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border);
}

.tool:disabled {
  color: var(--fg-subtle);
  opacity: 0.5;
}

.caret {
  color: var(--fg-subtle);
}

/* Beside the glyph, on every button at once or on none: `toolbarLabels`. The branch
   control keeps its name either way, being the one control naming a thing rather than an
   action. Every button keeps its label as a `title` regardless. */
.label {
  padding: 0 2px;
  font-size: var(--text-xs);
}

/* A branch name is read character by character, and an unbounded one would push the rest
   of the toolbar off the window. */
.branch {
  max-width: 180px;
  font-family: var(--font-mono);
}

/* The changed-file count, beside the Commit glyph rather than over its corner. Over it
, where a notification badge would go, it covered the top half of the glyph, and a
   circle with a stalk running under a badge reads as a lollipop, not as a commit.
   Drawn only when there is something to commit: a "0" would be a badge saying nothing
   is happening. */
.badge {
  min-width: 15px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--fg-on-accent);
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.tool:disabled .badge {
  background: var(--fg-subtle);
}
</style>
