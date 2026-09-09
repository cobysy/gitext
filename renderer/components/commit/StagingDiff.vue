<script setup lang="ts">
/**
 * The commit screen's diff: an editing surface, not a reading one. The main window's
 * diff is a Monaco diff editor, right for *reading*; this one is for *picking*, where
 * every line is a click target, which Monaco's own line rendering and selection model
 * fight rather than support.
 *
 * The colour is still Monaco's: `editor.colorize` is the tokenizer without the editor
 * (see "Syntax colour" below), so rows keep their clicks and still read as code.
 *
 * Every button's direction follows the side the file is on: unstaged can only be
 * staged, staged only unstaged. `staging.applyHunk` reads it from the store, so the
 * button and the patch can't disagree about which way round they are.
 */

import { computed, ref, watch } from 'vue';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { lineKey, STAGING_SIDE_STAGED, useStagingStore } from '@renderer/stores/staging.js';
import { hasPickableChange } from '@renderer/model/stagePatch.js';
import { useSyntaxColour } from './useSyntaxColour.js';
import { LINE_KIND_ADD, LINE_KIND_CONTEXT, LINE_KIND_DELETE, MARKER_ADD, MARKER_CONTEXT, MARKER_DELETE, type PatchHunk, type PatchLine } from '@renderer/model/patch.js';

const staging = useStagingStore();
const settings = useSettingsStore();


// ── Picking lines ───────────────────────────────────────────────────────────
// Lives in the store, not here: registry commands ("reset this chunk") must not reach
// into a component to find out what is selected. A flat set of `lineKey`s, not one per
// hunk, so "anything picked" is one lookup. Reassigned, not mutated: a `Set` isn't deeply reactive.

/** Where a shift-click measures from. */
const anchor = ref<{ hunk: number; line: number } | null>(null);

// A new file or reloaded patch is a new set of lines: carrying the old selection over
// would leave rows picked that aren't the rows that were picked. Keyed on the patch, not
// the click, so picks don't come off rows still on screen.
watch(
  () => [staging.patchTarget, staging.patchText] as const,
  () =>
  {
    staging.pickedLines = new Set();
    anchor.value = null;
  }
);

const file = computed(() => staging.patchFile);

/**
 * Which way this side's buttons move a change. From the patch on screen, not the
 * selected side: they disagree while a read is in flight, and a button following the
 * selection could offer "Unstage" over the unstaged diff.
 */
const staged = computed(() => staging.patchTarget?.side === STAGING_SIDE_STAGED);
const verb = computed(() =>
{
  if (staged.value)
  {
    return 'Unstage';
  }
  else
  {
    return 'Stage';
  }
});
/** A plus going into the index, a minus coming back out of it: the same shape the
 *  `+`/`-` markers already draw the change with, one level up. */
const actionGlyph = computed(() =>
{
  if (staged.value)
  {
    return 'M3 8h10';
  }
  else
  {
    return 'M8 3v10M3 8h10';
  }
});

const pickedCount = computed(() => staging.pickedLines.size);

/**
 * The picked lines of each hunk, by hunk index, as the indexes `buildHunkPatch` wants.
 * Built once per change, not scanned per hunk: every header asks twice, so a big patch
 * would walk the set many times per frame.
 */
const pickedByHunk = computed<Map<number, Set<number>>>(() =>
{
  const byHunk = new Map<number, Set<number>>();
  for (const entry of staging.pickedLines)
  {
    const [hunk, line] = entry.split(':');
    const at = Number(hunk);
    const lines = byHunk.get(at) ?? new Set<number>();
    lines.add(Number(line));
    byHunk.set(at, lines);
  }
  return byHunk;
});

/** One shared empty set for the hunks with nothing picked in them, which is most of them. */
const NONE_PICKED: ReadonlySet<number> = new Set();

const pickedIn = (hunkIndex: number): ReadonlySet<number> =>
  pickedByHunk.value.get(hunkIndex) ?? NONE_PICKED;

/** Through the by-hunk map, not the flat key set: a row is a lookup, not a built string. */
function isPicked(hunk: number, line: number): boolean
{
  return pickedIn(hunk).has(line);
}

/** Only a change can be picked; a context line is scenery. */
function isPickable(line: PatchLine): boolean
{
  return line.kind !== LINE_KIND_CONTEXT;
}

/** True when this click continues a shift-range pick started in the same hunk. */
function isShiftRangePick(
  event: MouseEvent,
  pick: { hunk: number; line: number } | null,
  hunkIndex: number
): pick is { hunk: number; line: number }
{
  return event.shiftKey && !!pick && pick.hunk === hunkIndex;
}

function onLineClick(hunkIndex: number, lineIndex: number, event: MouseEvent): void
{
  const hunk = file.value?.hunks[hunkIndex];
  const line = hunk?.lines[lineIndex];
  if (!line || !isPickable(line))
  {
    return;
  }

  // Which hunk "this hunk" means, for the commands that act on one: Reset Chunk in
  // particular, which without this would always mean the first.
  staging.focusedHunk = hunkIndex;

  const next = new Set(staging.pickedLines);
  const pick = anchor.value;

  if (isShiftRangePick(event, pick, hunkIndex))
  {
    // A range within one hunk. Across hunks it would have to mean something about the
    // lines between, and there is nothing sensible for it to mean.
    const [from, to] = [pick.line, lineIndex].sort((a, b) => a - b) as [number, number];
    for (let i = from; i <= to; i++)
    {
      if (isPickable(hunk!.lines[i]!))
      {
        next.add(lineKey(hunkIndex, i));
      }
    }
  }
  else
  {
    // A plain click toggles just this line, leaving every other pick alone: staging is
    // normally "these several lines", so a click that dropped the rest would undo
    // several clicks at once. Clearing is its own explicit action.
    const at = lineKey(hunkIndex, lineIndex);
    if (!next.delete(at))
    {
      next.add(at);
    }
    anchor.value = { hunk: hunkIndex, line: lineIndex };
  }

  staging.pickedLines = next;
}

/**
 * Each hunk with everything its header needs already worked out. One button per hunk,
 * not two: staging a whole hunk and staging some lines are the same verb at different
 * scope, so the button follows the selection instead of duplicating itself. Always
 * says which in words, since an icon and a bare count ("+1") is a puzzle, not a label.
 */
interface HunkRow {
  hunk: PatchHunk;
  label: string;
  /** Anything picked in this one, which is what keeps the button on screen. */
  picked: boolean;
  /** Nothing to stage out of a hunk of pure context. */
  enabled: boolean;
}

const hunkRows = computed<HunkRow[]>(() =>
  (file.value?.hunks ?? []).map((hunk, index) =>
  {
    const n = pickedIn(index).size;
    let label: string;
    if (n === 0)
    {
      label = `${verb.value} hunk`;
    }
    else
    {
      let plural: string;
      if (n === 1)
      {
        plural = '';
      }
      else
      {
        plural = 's';
      }
      label = `${verb.value} ${n} line${plural}`;
    }
    return {
      hunk,
      label,
      picked: n > 0,
      enabled: hasPickableChange(hunk)
    };
  })
);

/** Run whatever that hunk's button currently offers: picked lines if any, else all. */
async function applyHunkAction(hunkIndex: number): Promise<void>
{
  staging.focusedHunk = hunkIndex;
  const lines = pickedIn(hunkIndex);
  let picked: typeof lines | undefined;
  if (lines.size > 0)
  {
    picked = lines;
  }
  else
  {
    picked = undefined;
  }
  await staging.applyHunk(hunkIndex, picked);
}

/** Line numbers, blank on the side the line is not on. */
function numberOf(value: number | null): string
{
  if (value === null)
  {
    return '';
  }
  else
  {
    return String(value);
  }
}

// ── Syntax colour ───────────────────────────────────────────────────────────
// A self-contained mechanism, split out into `useSyntaxColour.ts`: see that file for what it does and why.

const patchPath = computed(() => staging.patchTarget?.path);
const theme = computed(() => settings.effectiveTheme);
const { lineHtml } = useSyntaxColour(file, patchPath, theme);
</script>

<template>
  <section class="staging-diff">
    <!-- The name of the file that's *drawn*, not selected: they disagree while a read
         is in flight, and the rows below can only be the patch in hand. -->
    <header class="head">
      <span class="path">{{ staging.patchTarget?.path ?? 'No file selected' }}</span>
      <span v-if="pickedCount" class="picked">{{ pickedCount }} selected</span>
    </header>

    <div v-if="!staging.selectedFile" class="message">
      Select a file to see what changed in it.
    </div>

    <div v-else-if="file?.isBinary" class="message">
      Binary: no text to stage from. Use the whole-file button.
    </div>

    <!-- Before the loading state: having a `file` means there's something true to
         draw, held while the next read runs, so clicking down the list never empties the pane. -->
    <div v-else-if="file && file.hunks.length > 0" class="hunks" tabindex="0">
      <article v-for="(row, hunkIndex) in hunkRows" :key="hunkIndex" class="hunk">
        <header class="hunk-head">
          <!-- One button, one place: the margin, aligned to the line-number gutter. A
               glyph, not a label, since a row of prose in a column of code looked
               cluttered; words live in the tooltip. -->
          <button
            class="hunk-action"
            :class="{ active: row.picked }"
            :disabled="!row.enabled"
            :title="row.label"
            :aria-label="row.label"
            @click="applyHunkAction(hunkIndex)"
          >
            <svg class="icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path :d="actionGlyph" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
            <!-- Drawn, not left to the native `title`, which never fires here: the
                 button appears under a cursor already still, and Chromium starts no tooltip timer without motion. -->
            <span class="tip">{{ row.label }}</span>
          </button>
          <span class="hunk-header">{{ row.hunk.header }}</span>
        </header>

        <div
          v-for="(line, lineIndex) in row.hunk.lines"
          :key="lineIndex"
          class="line"
          :class="[
            `kind-${line.kind}`,
            { picked: isPicked(hunkIndex, lineIndex), pickable: isPickable(line) }
          ]"
          @click="onLineClick(hunkIndex, lineIndex, $event)"
        >
          <span class="num old">{{ numberOf(line.oldNumber) }}</span>
          <span class="num new">{{ numberOf(line.newNumber) }}</span>
          <span class="marker">{{
            line.kind === LINE_KIND_ADD ? MARKER_ADD : line.kind === LINE_KIND_DELETE ? MARKER_DELETE : MARKER_CONTEXT
          }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -- monaco's escaping, or ours; see above -->
          <span class="text" v-html="lineHtml(hunkIndex, lineIndex, line.text)"></span>
        </div>
      </article>

      <p v-if="staging.patchTruncated" class="message truncated">
        This patch is too large to show in full; what is above is the start of it.
      </p>
    </div>

    <!-- Deliberately empty: a read takes a few milliseconds, and a line that appears
         and vanishes reads as a fault, not progress. -->
    <div v-else-if="staging.patchLoading" class="reading" />

    <div v-else class="message">No text changes to show.</div>
  </section>
</template>

<style scoped>
.staging-diff {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
  flex: 0 0 auto;
}

.path {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.picked {
  color: var(--fg-muted);
}

.message {
  padding: var(--space-3);
  color: var(--fg-muted);
  font-size: var(--text-sm);
}

/** Holds the body's place while the patch is read, so the pane cannot jump. */
.reading {
  flex: 1;
  min-height: 0;
}

.hunks {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.hunk {
  border-bottom: 1px solid var(--border-subtle);
}

/* The same column shape `.line` uses below, so the margin button lands in the line-number gutter rather than floating on its own. */
.hunk-head {
  display: grid;
  grid-template-columns: 4ch 4ch 1ch minmax(max-content, 1fr);
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-1) var(--space-2);
  background: var(--bg-subtle);
  position: sticky;
  top: 0;
  z-index: 1;
  /* Reserves the button's height so a hover revealing it doesn't shift the hunk. */
  min-height: 22px;
}

.hunk-header {
  grid-column: 4;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A margin glyph, sized as a proper click target. Words are in the `title`, read by
   pointing. Hidden until hovered so a diff being read stays a diff, same place on every hunk. */
.hunk-action {
  grid-column: 1 / span 3;
  justify-self: start;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--fg);
  visibility: hidden;
  cursor: pointer;
}

/* Sits right of the glyph over the `@@ … @@` header: the one strip of the pane with room to spare. */
.tip {
  position: absolute;
  left: calc(100% + var(--space-1));
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  padding: 1px var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  white-space: nowrap;
  pointer-events: none;
  display: none;
}

.hunk-action:hover:not(:disabled) .tip,
.hunk-action:focus-visible .tip {
  display: block;
}

/* Revealed by hovering anywhere in the hunk: the header alone is a ~20px strip and made the button feel hidden. */
.hunk:hover .hunk-action {
  visibility: visible;
}

/* Once lines are picked the button is the pending action, not an offer to discover: stays put, takes the accent. */
.hunk-action.active {
  visibility: visible;
  background: var(--accent);
  color: var(--fg-on-accent);
}

.hunk-action:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent);
}

.hunk-action.active:hover:not(:disabled) {
  background: var(--accent-hover);
  color: var(--fg-on-accent);
}

.hunk-action:disabled {
  visibility: hidden;
}

.hunk-action .icon {
  flex: none;
}

/* The grid keeps gutters aligned while text grows past the pane, so a long line scrolls sideways rather than wrapping. */
.line {
  display: grid;
  grid-template-columns: 4ch 4ch 1ch minmax(max-content, 1fr);
  gap: var(--space-1);
  padding: 0 var(--space-2);
  white-space: pre;
  line-height: 1.5;
}

.line.pickable {
  cursor: pointer;
}

.num {
  color: var(--fg-subtle);
  text-align: right;
  user-select: none;
}

.marker {
  user-select: none;
}

.kind-add {
  background: var(--diff-add-bg);
}

.kind-delete {
  background: var(--diff-del-bg);
}

.line.pickable:hover {
  outline: 1px solid var(--border);
  outline-offset: -1px;
}

/* Reads against both add and delete tints: accent laid over whatever tint is there,
   plus an edge bar. A background, not an outline, so a run of picked lines reads as one
   block. Not a font-weight change: bolding monospace at this size reads as blur, not selection. */
.line.picked {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg));
  box-shadow: inset 3px 0 0 var(--accent);
}

.line.picked:hover {
  background: color-mix(in srgb, var(--accent) 32%, var(--bg));
}

.truncated {
  border-top: 1px solid var(--border-subtle);
}
</style>
