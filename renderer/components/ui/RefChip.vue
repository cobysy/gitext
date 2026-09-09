<script setup lang="ts">
/**
 * Ref chip: branch/tag/remote in colored pill, solid when HEAD.
 * Filling keeps kind identifying.
 * a text/line-height bug that had to be found and fixed twice. This is the one copy.
 *
 * Two roles, one prop: the revision grid draws these inside a dense, virtualized row
 * list where nothing is clickable: clicking is how a row gets selected. The details
 * pane's copy is the one place a chip's name is worth grabbing on its own, so
 * `clickable` turns it into a button that emits `click` instead of a plain span.
 */

import type { CommitRef } from '@shared/types.js';

withDefaults(
  defineProps<{
    kind: CommitRef['kind'];
    name: string;
    current?: boolean;
    clickable?: boolean;
    title?: string;
  }>(),
  { current: false, clickable: false, title: undefined }
);

defineEmits<{ click: [] }>();
</script>

<template>
  <component
    :is="clickable ? 'button' : 'span'"
    class="ref-chip"
    :class="[kind, { current }]"
    :title="title"
    @click="clickable && $emit('click')"
  >{{ name }}</component>
</template>

<style scoped>
.ref-chip {
  flex: none;
  font-family: inherit;
  /* With padding: 0 vertical, the pill's height was exactly the line box's, and a
     line box's height is not split evenly around the glyphs: a font's ascent (above
     baseline) runs well past cap-height while its descent is mostly empty for text
     with no descenders, so a name like "master" sat visibly low, with headroom above
     and none below. line-height: 1 pulls the box down near the glyphs' own metrics,
     and equal padding puts a real, symmetric buffer around what's left: inline-flex +
     align-items: center then has actual slack to centre, rather than nothing to do. */
  display: inline-flex;
  align-items: center;
  line-height: 1;
  font-size: var(--text-xs);
  /* Thinner than the UI default (`button` resets to `font: inherit`, which is body's
     regular 400): a ref name is a label to scan past, not something to read closely,
     so the lighter weight is what keeps a row of several chips from out-shouting the
     commit message beside them. `--font-ui`'s system stack renders 300 cleanly on both
     platforms. */
  font-weight: 300;
  padding: 0px 5px 1px 5px;
  border-radius: var(--radius-sm);
  /* Always the lightest weight, regardless of Settings.graphLineWidth: a chip is a
     label, and a heavier outline reads as louder text, not a bolder line. */
  border: 0.5px solid var(--border);
  background: var(--bg-subtle);
  color: var(--fg);
  /* text-overflow: ellipsis does nothing unless white-space forbids wrapping, with
     wrapping allowed, a long name just wraps onto a second line inside the chip
     instead of ever overflowing horizontally. In the grid that second line sits
     outside the virtualized row's fixed height and is silently clipped, reading as
     cropped rather than wrapped; in the details pane, nothing constrains the row's
     height, so it visibly wraps instead. One line, always: the grid ellipsizes an
     overlong name, the details pane's `flex-wrap` moves the whole chip to a new row. */
  white-space: nowrap;
  /* max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis; */
  cursor: default;
}

button.ref-chip {
  cursor: pointer;
}

button.ref-chip:hover {
  background: var(--bg-hover);
}

.ref-chip.branch {
  border-color: var(--ref-branch);
  color: var(--ref-branch);
}

.ref-chip.tag {
  border-color: var(--ref-tag);
  color: var(--ref-tag);
}

.ref-chip.remote {
  border-color: var(--ref-remote);
  color: var(--ref-remote);
}

.ref-chip.current {
  font-weight: 600;
  color: var(--bg);
}

.ref-chip.branch.current {
  background: var(--ref-branch);
}

.ref-chip.tag.current {
  background: var(--ref-tag);
}

.ref-chip.remote.current {
  background: var(--ref-remote);
}

/* A bare `HEAD` chip is only ever drawn on a detached HEAD, so it is always `current`,
   and its kind has no colour of its own, since HEAD is not a kind of ref you can name.
   It fills with the plain foreground, which is what the base rule already draws it in:
   without a fill of its own, `.current`'s `color: var(--bg)` would be background on
   background, and the chip would read as an empty pill. */
.ref-chip.head.current {
  background: var(--fg);
}
</style>
