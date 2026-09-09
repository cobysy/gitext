<script setup lang="ts">
/**
 * The lane graph, drawn on one canvas covering the visible rows. A canvas rather than
 * DOM because a busy history draws thousands of lines, and one element each would swamp
 * the layout engine; nothing is drawn for rows nobody can see. The geometry lives in
 * `graph/`; this file keeps only what a Vue component should own: props, the canvas ref,
 * DPR and size, the palette read from CSS, and `draw()`.
 */

import { computed, onMounted, ref, watch } from 'vue';
import type { GraphRow } from '@renderer/model/graph/index.js';
import { GRAPH_COLOR_COUNT } from '@renderer/model/graph/index.js';
import { gutterWidth, MAX_LANES } from './geometry.js';
import { drawRow } from './graph/graphRenderer.js';

const props = defineProps<{
  rows: GraphRow[];
  /** First visible row index. */
  start: number;
  /** One past the last visible row index. */
  end: number;
  rowHeight: number;
  /** Stroke width of a lane line, in CSS pixels. */
  lineWidth: number;
  /** Visible rows that are selected, drawn with a filled node. A set, not one index, since the grid supports Ctrl- and Shift-click. */
  selected: ReadonlySet<number>;
  /** Visible rows carrying a branch, tag or other ref, drawn as a square rather than a circle. Orthogonal to selection: a selected ref commit is a filled square. */
  hasRefs: ReadonlySet<number>;
  /** The ancestry marks. Zero-length means nothing is highlighted, so nothing dims. */
  relative: Uint8Array;
  /** Row holding the checked-out commit, or -1 when it is detached, unborn or unloaded. */
  head: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);

const laneCount = computed(() =>
{
  let widest = 1;
  for (let i = props.start; i < props.end; i++)
  {
    const row = props.rows[i];
    if (row)
    {
      widest = Math.max(widest, row.laneCount);
    }
  }
  return Math.min(widest, MAX_LANES);
});

const width = computed(() => gutterWidth(laneCount.value));
const height = computed(() => Math.max(0, (props.end - props.start) * props.rowHeight));

/** Palette lives in CSS so the two themes stay in one place: `--graph-0`…`--graph-6` in `styles/tokens.css`, like every other colour in the app. */
function token(name: string, fallback: string): string
{
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function draw(): void
{
  const el = canvas.value;
  if (!el)
  {
    return;
  }

  const ctx = el.getContext('2d');
  if (!ctx)
  {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  el.width = Math.round(width.value * dpr);
  el.height = Math.round(height.value * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width.value, height.value);

  const context = {
    ctx,
    rowHeight: props.rowHeight,
    lineWidth: props.lineWidth,
    colors: Array.from({ length: GRAPH_COLOR_COUNT }, (_, i) => token(`--graph-${i}`, '#888')),
    dimColor: token('--graph-dim', '#888'),
    background: token('--bg', '#fff'),
    foreground: token('--fg', '#000'),
    relative: props.relative,
    isSelected: (index: number): boolean => props.selected.has(index),
    hasRefs: (index: number): boolean => props.hasRefs.has(index),
    head: props.head
  };

  // A row is drawn whole and entirely inside its own strip: every line reaches the edge
  // travelling vertically, so there is nothing to clip and no neighbouring row to consult.
  for (let index = props.start; index < props.end; index++)
  {
    const row = props.rows[index];
    if (row)
    {
      drawRow(row, index, (index - props.start) * props.rowHeight, context);
    }
  }
}

onMounted(draw);
watch(
  () => [
    props.rows,
    props.start,
    props.end,
    props.selected,
    props.hasRefs,
    props.rowHeight,
    props.lineWidth,
    props.relative,
    props.head
  ],
  draw,
  { deep: false }
);

defineExpose({ width });
</script>

<template>
  <canvas
    ref="canvas"
    class="graph"
    :style="{ width: `${width}px`, height: `${height}px` }"
    aria-hidden="true"
  />
</template>

<style scoped>
.graph {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
</style>
