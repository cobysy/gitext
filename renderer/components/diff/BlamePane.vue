<script setup lang="ts">
/**
 * A blamed file: who wrote each line in a column, the file itself in a read-only Monaco
 * beside it, the two scrolled as one.
 *
 * It owns the pairing and nothing else. Reading the blame is the caller's: the file
 * history window blames whichever revision its list has picked, while the repository
 * window blames the file the tree is on, and neither knows the other's question.
 *
 * The gutter steps in the editor's own line height and starts under its own top padding
 * (`EDITOR_LINE_HEIGHT`, `EDITOR_PADDING_TOP`), which is what keeps the two columns level
 * at any scroll position. Only the rows in view are drawn, inside a box the height of the
 * whole file: the scrollbar is still the file's, and a 20,000-line file is a screenful of
 * elements rather than 20,000 of them. Its own scrollbar is hidden, since two side by
 * side would read as two panes rather than one.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { BlameFile } from '@shared/types.js';
import { formatCommitDate } from '@renderer/format.js';
import {
  blameGutterRows,
  blameText,
  gutterWindow,
  UNCOMMITTED_SHA
} from '@renderer/model/blameGutter.js';
import { languageForPath } from '@renderer/monacoLang.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import {
  EDITOR_LINE_HEIGHT,
  EDITOR_PADDING_TOP,
  useReadOnlyEditor,
  type ReadOnlyEditorContent
} from '@renderer/components/diff/useReadOnlyEditor.js';

/** Rows kept either side of the viewport, so a fast scroll never shows a blank strip. */
const OVERSCAN_ROWS = 12;

const props = defineProps<{
  blame: BlameFile | null;
  /** The file's path, for the editor's language. */
  path: string;
  /** This pane's Monaco model identity, distinct from every other pane's. */
  uriTag: string;
}>();

const emit = defineEmits<{ pick: [sha: string] }>();

const settings = useSettingsStore();

/** Not text, so there is nothing to attribute: the pane says so instead of drawing. */
const binary = computed(() => props.blame?.binary === true);

const rows = computed(() => blameGutterRows(props.blame));

function pick(sha: string): void
{
  // There is no commit behind an uncommitted line to go to.
  if (sha === UNCOMMITTED_SHA)
  {
    return;
  }
  emit('pick', sha);
}

const editorHost = ref<HTMLElement | null>(null);
const gutter = ref<HTMLElement | null>(null);
let syncingScroll = false;

// ── The drawn window ─────────────────────────────────────────────────────────

const scrollTop = ref(0);
const viewportHeight = ref(0);

const drawn = computed(() =>
  gutterWindow(
    rows.value.length,
    scrollTop.value,
    viewportHeight.value,
    EDITOR_LINE_HEIGHT,
    EDITOR_PADDING_TOP,
    OVERSCAN_ROWS
  )
);

/** The rows in view, each still knowing which line of the file it is. */
const visible = computed(() =>
  rows.value
    .slice(drawn.value.first, drawn.value.first + drawn.value.count)
    .map((row, i) => ({ ...row, line: drawn.value.first + i }))
);

let resizeObserver: ResizeObserver | null = null;

function measure(): void
{
  viewportHeight.value = gutter.value?.clientHeight ?? 0;
}

onMounted(() =>
{
  measure();
  if (gutter.value)
  {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(gutter.value);
  }
});

onUnmounted(() =>
{
  resizeObserver?.disconnect();
  resizeObserver = null;
});

// ── The two halves, scrolled as one ──────────────────────────────────────────

const content = computed<ReadOnlyEditorContent | null>(() =>
{
  if (!props.blame || props.blame.binary)
  {
    return null;
  }
  return { text: blameText(props.blame), language: languageForPath(props.path) };
});

const pane = useReadOnlyEditor({
  host: editorHost,
  effectiveTheme: () => settings.effectiveTheme,
  uriTag: props.uriTag,
  content: () => content.value,
  onScroll: (top) =>
  {
    // Taken here rather than waiting for the gutter's own scroll event, which arrives a
    // frame later: the column would then be drawn one frame behind the lines it names.
    scrollTop.value = top;
    if (syncingScroll || !gutter.value)
    {
      return;
    }
    syncingScroll = true;
    gutter.value.scrollTop = top;
    syncingScroll = false;
  }
});

function onGutterScroll(): void
{
  const el = gutter.value;
  if (!el)
  {
    return;
  }
  scrollTop.value = el.scrollTop;
  if (syncingScroll)
  {
    return;
  }
  syncingScroll = true;
  pane.scrollTo(el.scrollTop);
  syncingScroll = false;
}
</script>

<template>
  <div class="blame-pane" :style="{ '--blame-row-height': `${EDITOR_LINE_HEIGHT}px` }">
    <p v-if="binary" class="placeholder">
      This is a binary file; there is nothing to attribute line by line.
    </p>

    <div v-show="!binary" ref="gutter" class="gutter" @scroll="onGutterScroll">
      <div class="column" :style="{ height: `${drawn.height}px` }">
        <div class="window" :style="{ transform: `translateY(${drawn.offset}px)` }">
          <div
            v-for="row in visible"
            :key="row.line"
            class="row"
            :class="{ uncommitted: row.sha === UNCOMMITTED_SHA }"
            @click="pick(row.sha)"
          >
            <template v-if="!row.repeat">
              <template v-if="row.sha === UNCOMMITTED_SHA">
                <span class="who">Uncommitted</span>
              </template>
              <template v-else>
                <span class="who truncate">{{ row.commit?.author }}</span>
                <span class="when">
                  {{ row.commit ? formatCommitDate(row.commit.authorTime, settings.settings.dateFormat) : '' }}
                </span>
              </template>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-show="!binary" ref="editorHost" class="monaco" />
  </div>
</template>

<style scoped>
.blame-pane {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

.monaco {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.gutter {
  flex: none;
  width: 220px;
  overflow-y: scroll;
  scrollbar-width: none;
  border-right: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
}

.gutter::-webkit-scrollbar {
  display: none;
}

/* The whole file's height, holding only the rows in view: what makes the scrollbar the
   file's own while the elements under it are a viewport's worth. */
.column {
  position: relative;
}

.window {
  position: absolute;
  inset-inline: 0;
  top: 0;
}

.gutter .row {
  height: var(--blame-row-height);
  line-height: var(--blame-row-height);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.gutter .row:hover {
  background: var(--bg-subtle);
}

.gutter .row.uncommitted .who {
  color: var(--warning);
}

/* A fixed column rather than a name's own width: the dates beside them then read down
   the gutter as a column instead of stepping right with each author's name. */
.gutter .who {
  color: var(--fg-subtle);
  flex: none;
  width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gutter .when {
  color: var(--fg-subtle);
  flex: none;
}
</style>
