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
 *
 * A run of one commit is named on its first row and blank below it, so what tells the
 * rows apart is the block they sit in: neighbouring runs alternate in shade, a rule is
 * drawn where one takes over from the last, and hovering any line marks every line the
 * same commit wrote, wherever else in the file it wrote one.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { BlameFile } from '@shared/types.js';
import { formatCommitDate } from '@renderer/format.js';
import {
  blameGutterRows,
  blameText,
  evenPlacements,
  gutterWindow,
  laidOutPlacements,
  linesOfCommit,
  UNCOMMITTED_SHA,
  type GutterPlacement
} from '@renderer/model/blameGutter.js';
import { languageForPath } from '@renderer/monacoLang.js';
import { shortSha } from '@renderer/model/sha.js';
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

/**
 * The commit under the pointer, marked on every line of it.
 *
 * The question the gutter is usually asked is which lines one commit wrote, and its
 * lines are rarely one run: an answer that stops at the block being pointed at answers
 * only part of it. The mark is drawn across the text as well as the gutter, since the
 * lines are what was asked about and a band that stops at the column's edge names them
 * without showing them.
 */
const hovered = ref<string | null>(null);

/** What a row draws for its commit, and what its tooltip says. */
interface CommitLabel {
  sha: string;
  when: string;
  title: string;
}

const UNCOMMITTED_LABEL: CommitLabel = { sha: '', when: '', title: 'Not committed yet' };

/**
 * The strings a row draws, worked out once per commit.
 *
 * A file is written by a handful of commits and a scroll redraws forty rows a frame:
 * formatting a date and building a tooltip in the template is work per row per frame,
 * and it is paid again on every one of them. The date format is read here, so a change
 * of setting rebuilds the labels.
 */
const labels = computed(() =>
{
  const format = settings.settings.dateFormat;
  const byCommit = new Map<string, CommitLabel>();
  for (const [sha, commit] of Object.entries(props.blame?.commits ?? {}))
  {
    const when = formatCommitDate(commit.authorTime, format);
    byCommit.set(sha, {
      sha: shortSha(sha),
      when,
      // Plain text: nothing renders markup in a `title`, so the backtick rule does not
      // apply and the summary goes in as git wrote it.
      title: `${shortSha(sha)} \u00b7 ${commit.author} \u00b7 ${when}\n${commit.summary}`
    });
  }
  return byCommit;
});

function labelOf(sha: string): CommitLabel
{
  if (sha === UNCOMMITTED_SHA)
  {
    return UNCOMMITTED_LABEL;
  }
  // Blame named the commit but said nothing about it, which leaves its SHA to go on.
  return labels.value.get(sha) ?? { sha: shortSha(sha), when: '', title: shortSha(sha) };
}

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

const scrollTop = ref(0);
const viewportHeight = ref(0);

/**
 * Bumped whenever the editor has moved its lines under a scroll position that has not
 * changed: what a fold does. The placements are read from the editor imperatively, so
 * this is what tells the drawing that the answer is a different one now.
 */
const relayouts = ref(0);

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
    scrollTop.value = top;
  },
  onRelayout: () =>
  {
    relayouts.value += 1;
  }
});

/**
 * A wheel over the column scrolls the editor, which scrolls the column back through
 * `onScroll`: the gutter has no scroll of its own to drift from the editor's.
 *
 * A line at a time and a page at a time are what a mouse and a trackpad send on some
 * platforms, and a delta is in those units rather than in px until it is converted.
 */
function onGutterWheel(event: WheelEvent): void
{
  let delta = event.deltaY;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE)
  {
    delta *= EDITOR_LINE_HEIGHT;
  }
  else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
  {
    delta *= Math.max(EDITOR_LINE_HEIGHT, viewportHeight.value);
  }
  pane.scrollTo(scrollTop.value + delta);
}

/** The class the marked lines carry, defined in this file's unscoped style block. */
const MARKED_LINE = 'gitext-blame-line';

watch([hovered, rows], ([sha, lines]) =>
{
  if (!sha)
  {
    pane.markLines([], MARKED_LINE);
    return;
  }
  pane.markLines(linesOfCommit(lines, sha), MARKED_LINE);
});

// ── The drawn window ─────────────────────────────────────────────────────────

/** The even step to fall back on, for the moment before the editor has laid the file out. */
const evenly = computed(() =>
  gutterWindow(
    rows.value.length,
    scrollTop.value,
    viewportHeight.value,
    EDITOR_LINE_HEIGHT,
    EDITOR_PADDING_TOP,
    OVERSCAN_ROWS
  )
);

/**
 * Where each drawn row goes, and how tall the column is.
 *
 * The editor is asked first: it is the only one that knows where a line ended up once a
 * fold has closed over the lines above it. Its own step is what the fallback computes,
 * so the two agree with nothing folded and the gutter is drawn from the first frame.
 */
const drawn = computed<GutterPlacement[]>(() =>
{
  // Read so the placements are taken again when the editor has moved its lines.
  void relayouts.value;
  void scrollTop.value;
  void viewportHeight.value;

  const lines = pane.lineLayout();
  if (lines && lines.visible.length > 0)
  {
    return laidOutPlacements(rows.value.length, lines, OVERSCAN_ROWS);
  }
  return evenPlacements(evenly.value, EDITOR_LINE_HEIGHT);
});

/** The rows in view, each still knowing which line of the file it is and where it goes. */
const visible = computed(() =>
  drawn.value.flatMap((placement) =>
  {
    const row = rows.value[placement.line];
    if (!row)
    {
      return [];
    }
    return [{ ...row, line: placement.line, top: placement.top }];
  })
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

</script>

<template>
  <div class="blame-pane" :style="{ '--blame-row-height': `${EDITOR_LINE_HEIGHT}px` }">
    <p v-if="binary" class="placeholder">
      This is a binary file; there is nothing to attribute line by line.
    </p>

    <div
      v-show="!binary"
      ref="gutter"
      class="gutter"
      @wheel.prevent="onGutterWheel"
      @mouseleave="hovered = null"
    >
      <div class="column" :style="{ transform: `translateY(${-scrollTop}px)` }">
        <div
          v-for="row in visible"
          :key="row.line"
          class="row"
          :style="{ top: `${row.top}px` }"
          :class="{
            band: row.band,
            starts: !row.repeat && row.line > 0,
            same: row.sha === hovered,
            uncommitted: row.sha === UNCOMMITTED_SHA
          }"
          :title="labelOf(row.sha).title"
          @mouseenter="hovered = row.sha"
          @click="pick(row.sha)"
        >
          <template v-if="!row.repeat">
            <template v-if="row.sha === UNCOMMITTED_SHA">
              <span class="who">Uncommitted</span>
            </template>
            <template v-else>
              <span class="sha">{{ labelOf(row.sha).sha }}</span>
              <span class="who truncate">{{ row.commit?.author }}</span>
              <span class="when">{{ labelOf(row.sha).when }}</span>
            </template>
          </template>
        </div>
      </div>
    </div>

    <div v-show="!binary" ref="editorHost" class="monaco" />
  </div>
</template>

<!--
  Unscoped, deliberately: Monaco builds the lines of the file itself, outside Vue's
  render tree, so a scoped block's `data-v-*` attribute is on nothing they carry.
  `gitext-` prefixed to stay clear of the rest of the app.
-->
<style>
/* The lines the commit under the pointer wrote, in the same colour as its rows in the
   gutter: the two are one band across the pane, which is what says the rows name these
   lines. A background only, so the text keeps its own syntax colours. */
.gitext-blame-line {
  background: var(--bg-selected);
}
</style>

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

/* No scroll of its own: the editor holds the pane's position, and a wheel over the
   column is handed to it. Two scrollers, one of them told where to go, is what puts the
   names a frame behind the lines they name. */
.gutter {
  flex: none;
  width: 264px;
  overflow: hidden;
  border-right: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
}

/* Holds only the rows in view, moved as one to the editor's scroll position. Each row
   sits at the top the editor gave its line, so a fold moves the two columns together. */
.column {
  position: relative;
  will-change: transform;
}

.gutter .row {
  position: absolute;
  inset-inline: 0;
  height: var(--blame-row-height);
  line-height: var(--blame-row-height);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

/* Every other run, so a block of lines is one shade to its neighbours' other. */
.gutter .row.band {
  background: var(--bg-subtle);
}

/*
 * The rule where one run takes over from the last.
 *
 * An inset shadow rather than a border: a border is a pixel of height, and a gutter row
 * a pixel taller than the editor's line slides a long file out of step with the text it
 * names.
 */
.gutter .row.starts {
  box-shadow: inset 0 1px 0 var(--border);
}

/* Written after `.band` so it wins at equal specificity: which commit wrote the line
   under the pointer is the question being asked, and the shading is the background. */
.gutter .row.same {
  background: var(--bg-selected);
}

.gutter .row.uncommitted .who {
  color: var(--warning);
}

/* Fixed columns rather than each value's own width: the three then read down the gutter
   as columns instead of stepping right with the length of each author's name. */
.gutter .sha {
  font-family: var(--font-mono);
  color: var(--fg-muted);
  flex: none;
}

.gutter .who {
  color: var(--fg-subtle);
  flex: none;
  width: 104px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gutter .when {
  color: var(--fg-subtle);
  flex: none;
}
</style>
