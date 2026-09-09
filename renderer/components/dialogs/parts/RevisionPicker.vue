<script setup lang="ts">
/**
 * Pick a revision: one filter box over the refs, which also accepts a revision matching
 * none of them. **Filter-first, not a dropdown**: a repository with a thousand release
 * tags breaks a `<select>` (what `RefPicker` still is elsewhere), and one input narrows
 * the list *and* resolves whatever is typed, which is how a SHA out of a bug report
 * gets in. Extracted from `RevisionSlot.vue`, which shows this in a popover; Go to
 * Commit *is* it. Grouping logic lives as testable, DOM-free code in `revisionChoices.ts`.
 */

import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { newestOnly } from '@renderer/model/newest.js';
import { shortSha } from '@renderer/format.js';
import {
  revisionChoices,
  typedIsWorthShowing,
  visibleChoices,
  SHOWN_PER_KIND,
  type RevisionChoice
} from '@renderer/model/revisionChoices.js';
import type { CommitSummary } from '@shared/types.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { KEY_ARROW_DOWN, KEY_ARROW_UP, KEY_END, KEY_HOME } from '@renderer/keys.js';

const CHOICE_KIND_REVISION = 'revision';

/** The row the keyboard is on: what a caller's own confirming button acts upon. */
const active = defineModel<RevisionChoice | null>({ default: null });

const props = withDefaults(
  defineProps<{
    /** Offer the working tree and the index alongside the commits. */
    includeWorking?: boolean;
    placeholder?: string;
    /** Seed the box: a revision the caller already has a reason to believe in. */
    initialQuery?: string;
    /** Take the keyboard on mount. A popover focuses it itself, on opening. */
    autofocus?: boolean;
  }>(),
  {
    includeWorking: false,
    placeholder: 'Branch, tag, or SHA…',
    initialQuery: '',
    autofocus: false
  }
);

const emit = defineEmits<{
  /** A row was picked outright: clicked, or Enter'd where the picker owns Enter. */
  choose: [RevisionChoice];
}>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();

const query = ref(props.initialQuery);
const queryInput = ref<HTMLInputElement | null>(null);
const rowsEl = ref<HTMLElement | null>(null);

/** What the typed text resolves to, when it is not already in the list below. */
const typed = ref<CommitSummary | null>(null);

/** Drops a resolution a later keystroke has already superseded. */
const resolving = newestOnly();

const groups = computed(() =>
  revisionChoices({
    refs: objects.refs,
    query: query.value,
    typed: typed.value,
    includeWorking: props.includeWorking
  })
);

/** The drawn rows, flat, in the order the arrow keys walk them. */
const rows = computed(() => visibleChoices(groups.value));

const activeIndex = computed(() =>
  rows.value.findIndex((row) => row.key === active.value?.key)
);

/**
 * Keep the highlight on a row that still exists. The list is rebuilt on every
 * keystroke, so falling back to the first row rather than nothing is what makes
 * typing-then-Enter work without an arrow key in between.
 */
watch(
  rows,
  (list) =>
  {
    if (list.length === 0)
    {
      active.value = null;
      return;
    }
    if (!list.some((row) => row.key === active.value?.key))
    {
      active.value = list[0] ?? null;
    }
  },
  { immediate: true }
);

/**
 * Resolve what was typed, but only once it stands a chance of resolving. Asked on every
 * keystroke since a `git log -1` is cheap. Two characters is the floor: a one-character SHA prefix matches most of the repository.
 */
watch(
  query,
  async (value) =>
  {
    const text = value.trim();
    const path = repo.repo?.path;
    if (!path || text.length < 2)
    {
      typed.value = null;
      return;
    }
    // Typing runs ahead of git, and two `describe`s started a keystroke apart come back in whatever order they finish in; without this, Enter could pick the wrong operand.
    const current = resolving.begin();
    const found = await api['revisions:describe'](path, text);
    if (!current())
    {
      return;
    }
    if (typedIsWorthShowing(found, text, objects.refs))
    {
      typed.value = found;
    }
    else
    {
      typed.value = null;
    }
  },
  { immediate: true }
);

function move(delta: number): void
{
  const list = rows.value;
  if (list.length === 0)
  {
    return;
  }
  const from = activeIndex.value;
  let base: number;
  if (from === -1)
  {
    base = 0;
  }
  else
  {
    base = from;
  }
  const next = Math.min(Math.max(base + delta, 0), list.length - 1);
  active.value = list[next] ?? null;
  void nextTick(scrollActiveIntoView);
}

/** `scrollTop`/`clientHeight` on the row's own box, not `scrollIntoView`: the picker sits inside a scrolling pane, and the block-level version would scroll its ancestors too. */
function scrollActiveIntoView(): void
{
  const container = rowsEl.value;
  const el = container?.querySelector<HTMLElement>('.row.active');
  if (!container || !el)
  {
    return;
  }
  if (el.offsetTop < container.scrollTop)
  {
    container.scrollTo({ top: el.offsetTop });
  }
  else if (el.offsetTop + el.offsetHeight > container.scrollTop + container.clientHeight)
  {
    container.scrollTo({ top: el.offsetTop + el.offsetHeight - container.clientHeight });
  }
}

function onKeydown(event: KeyboardEvent): void
{
  switch (event.key)
  {
    case KEY_ARROW_DOWN:
      move(1);
      break;
    case KEY_ARROW_UP:
      move(-1);
      break;
    case KEY_HOME:
      move(-rows.value.length);
      break;
    case KEY_END:
      move(rows.value.length);
      break;
    default:
      return;
  }
  // The caret would otherwise run to either end of the box on every Up and Down.
  event.preventDefault();
}

function pick(choice: RevisionChoice): void
{
  active.value = choice;
  emit('choose', choice);
}

/** Focus the box, and select what is in it: a seeded revision is meant to be typed over. */
function focus(): void
{
  queryInput.value?.focus();
  queryInput.value?.select();
}

defineExpose({ focus });

onMounted(() =>
{
  if (props.autofocus)
  {
    void nextTick(focus);
  }
});
</script>

<template>
  <div class="picker-body">
    <input
      ref="queryInput"
      v-model="query"
      class="search"
      type="text"
      :placeholder="props.placeholder"
      spellcheck="false"
      autocomplete="off"
      @keydown="onKeydown"
    />

    <div ref="rowsEl" class="rows">
      <template v-for="group in groups" :key="group.title">
        <p class="grp">
          {{ group.title }}
          <!-- Stated, never silently truncated: a picker that quietly drops a thousand tags is worse than one that lists them. -->
          <span v-if="group.items.length > SHOWN_PER_KIND" class="more">
            {{ group.items.length - SHOWN_PER_KIND }} more: keep typing
          </span>
        </p>
        <button
          v-for="choice in group.items.slice(0, SHOWN_PER_KIND)"
          :key="choice.key"
          class="row"
          :class="{ active: choice.key === active?.key }"
          type="button"
          @click="pick(choice)"
        >
          <span :class="choice.kind === CHOICE_KIND_REVISION ? 'mono' : 'truncate'">
            {{ choice.kind === CHOICE_KIND_REVISION ? shortSha(choice.name) : choice.name }}
          </span>
          <span v-if="choice.detail" class="dim truncate">{{ choice.detail }}</span>
        </button>
      </template>

      <p v-if="groups.length === 0" class="grp empty">
        {{ query.trim() ? `Nothing matches “${query.trim()}”` : 'No refs in this repository.' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.picker-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.search {
  width: 100%;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.rows {
  flex: 1;
  max-height: 300px;
  overflow-y: auto;
  margin-top: var(--space-1);
}

.grp {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin: var(--space-1) 0 2px;
  padding: 0 var(--space-2);
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--fg-subtle);
}

.grp.empty {
  text-transform: none;
  letter-spacing: 0;
  font-size: var(--text-sm);
  padding: var(--space-2);
}

.more {
  text-transform: none;
  letter-spacing: 0;
  font-size: var(--text-xs);
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  text-align: left;
  padding: 3px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg);
}

/* The keyboard's row and the pointer's row read the same, since they mean the same thing: this is what Enter or a click would take. */
.row:hover,
.row.active {
  background: var(--bg-hover);
}

.dim {
  color: var(--fg-subtle);
  font-size: var(--text-xs);
}

.mono {
  color: var(--fg-muted);
}
</style>
