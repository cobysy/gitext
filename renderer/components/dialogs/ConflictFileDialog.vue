<script setup lang="ts">
/**
 * Resolving one conflicted file without leaving the app, from `ResolveConflictsDialog`'s
 * "Resolve here…": base/ours/theirs as two read-only diffs, and git's own merge
 * attempt, markers and all, as one editable pane with a floating toolbar over each remaining block.
 *
 * The toolbar is real DOM Monaco holds open as a view zone, not a Vue component:
 * `changeViewZones` takes a raw node; rebuilding from a fresh parse (`rebuildZones`)
 * beats tracking every block's effect on the rest's line numbers by hand.
 */

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import * as monaco from '@renderer/monaco.js';
import { applyMonacoTheme, monacoThemeName } from '@renderer/monaco.js';
import { languageForPath } from '@renderer/monacoLang.js';
import { formatRelativeDate } from '@renderer/format.js';
import { ENDPOINT_KIND_COMMIT } from '@shared/diff.js';
import {
  hasConflictMarkers,
  parseConflictBlocks,
  resolveConflictBlock,
  type ConflictBlock,
  type ConflictChoice
} from '@renderer/model/conflictMarkers.js';
import { conflictRegions, type ConflictRegionKind } from '@renderer/model/conflictRegions.js';
import { commitForLines, findLineRange, latestCommit } from '@renderer/model/conflictBlame.js';
import { suggestAutoMerges } from '@renderer/model/conflictAutoMerge.js';
import { buildMarkResolvedArgs, describeSides } from '@renderer/model/args/conflicts.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useReferencePanes } from '@renderer/components/dialogs/conflict/useReferencePanes.js';
import { buildBlockToolbar } from '@renderer/components/dialogs/conflict/blockToolbar.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import ConflictIcon from '@renderer/components/ui/ConflictIcon.vue';
import ConflictLegend from '@renderer/components/ui/ConflictLegend.vue';
import type { ConflictIconName } from '@renderer/components/ui/conflictIcons.js';
import { STAGING } from '@shared/invalidation.js';
import {
  OPERATION_REBASE as OP_REBASE,
  type BlameCommitInfo,
  type BlameFile,
  type ConflictBlobs,
  type ConflictSideRef,
  type ConflictSides
} from '@shared/types.js';

const FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
/** A block's toolbar is a button row, plus a smaller attribution row when there's one
 *  to show: Monaco needs a zone's height fixed up front, so the two are added, not measured. */
const TOOLBAR_ROW_PX = 24;
const TOOLBAR_ATTRIBUTION_ROW_PX = 18;
// `ConflictSide` (`describeSides`'s domain: which side of the merge) not
// `ConflictChoice` (what a toolbar button keeps): they share the words but aren't the same thing.
const SIDE_OURS = 'ours';
const SIDE_THEIRS = 'theirs';
const REGION_MARKER: ConflictRegionKind = 'marker';

const props = defineProps<{ filePath: string }>();
const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { busy, error, perform, run } = useDialog();

const loading = ref(true);
/** True once loaded, for a conflict with no inline markers at all (add/add,
 *  delete/modify): set once from the first parse, never touched again. */
const noMarkersAtAll = ref(false);
const remainingBlocks = ref<ConflictBlock[]>([]);

/**
 * Whether any marker at all is still in the editor: what guards the save, blunter
 * than `remainingBlocks`, or a hand-deleted `=======` gets staged with the file.
 */
const markersRemain = ref(false);
const blobs = ref<ConflictBlobs | null>(null);

/**
 * Which commit each side is, and its blame: kept separate from `blobs`, since a
 * repository with no useful ref for a side still opens the editor with these simply absent.
 */
const sidesRefs = ref<ConflictSides | null>(null);
const oursBlame = ref<BlameFile | null>(null);
const theirsBlame = ref<BlameFile | null>(null);

const rebasing = computed(() => repo.state.operation === OP_REBASE);
const sides = computed(() => describeSides(rebasing.value));
const language = computed(() => languageForPath(props.filePath));
const effectiveTheme = computed(() => settings.effectiveTheme);
const baseLines = computed<string[] | null>(() =>
{
  const base = blobs.value?.base;
  if (base === null || base === undefined)
  {
    return null;
  }
  return base.split('\n');
});

const oursLatest = computed(() => latestCommit(oursBlame.value));
const theirsLatest = computed(() => latestCommit(theirsBlame.value));

/**
 * The word this dialog calls each side: `Mine`/`Incoming` for a merge, `Base`/`Mine`
 * for a rebase. One vocabulary everywhere; git's `ours`/`theirs` appear only in tooltips.
 */
const oursRole = computed(
  () => sides.value.find((entry) => entry.side === SIDE_OURS)?.role ?? 'Ours'
);
const theirsRole = computed(
  () => sides.value.find((entry) => entry.side === SIDE_THEIRS)?.role ?? 'Theirs'
);

/**
 * What each shape on a block's toolbar means, built from `sides` so the words match
 * the operation: mid-rebase the incoming side is the commit *you* wrote.
 */
const legendItems = computed<{ icon: ConflictIconName; label: string }[]>(() =>
{
  const items: { icon: ConflictIconName; label: string }[] = [
    { icon: 'keepMine', label: `Keep ${oursRole.value}` },
    { icon: 'keepIncoming', label: `Keep ${theirsRole.value}` },
    { icon: 'keepMineThenIncoming', label: `Keep both, ${oursRole.value} first` },
    { icon: 'keepIncomingThenMine', label: `Keep both, ${theirsRole.value} first` },
    { icon: 'keepBase', label: 'Keep the common ancestor' }
  ];
  // Only when a block has it: a legend entry for a button nobody can see explains nothing.
  if (autoMergeable.value.size > 0)
  {
    items.unshift({ icon: 'autoMerge', label: 'Merge both automatically' });
  }
  return items;
});

/**
 * "sweet · Alice, 2 days ago: 'swap salt for vanilla'", for a pane label. Narrows: a
 * blamed side, then an `am` patch's sequencer-recorded author, then just its name.
 */
function sideSubtitle(ref_: ConflictSideRef | null, commit: BlameCommitInfo | null): string
{
  if (!ref_)
  {
    return '';
  }
  if (commit)
  {
    return `${ref_.name} · ${commit.author}, ${formatRelativeDate(commit.authorTime)}: "${commit.summary}"`;
  }
  if (ref_.author && ref_.authorTime !== undefined)
  {
    return `${ref_.name} · ${ref_.author}, ${formatRelativeDate(ref_.authorTime)}`;
  }
  if (ref_.author)
  {
    return `${ref_.name} · ${ref_.author}`;
  }
  return ref_.name;
}

/** Base against ours and base against theirs: two editors and their lifetimes, held elsewhere. */
const referencePanes = useReferencePanes({
  blobs: () => blobs.value,
  language: () => language.value,
  theme: () => effectiveTheme.value
});
const resultHost = ref<HTMLElement | null>(null);

let resultEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let resultResize: ResizeObserver | null = null;
/** The side colouring, held as a collection rather than ids: Monaco keeps a
 *  collection's ranges current through an edit, so a keystroke doesn't leave the tint a line behind. */
let resultDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let initialWorking = '';
let zoneIds: string[] = [];
let zoneRebuildPending = false;

// ── Loading ──────────────────────────────────────────────────────────────────

async function load(): Promise<void>
{
  const repoPath = repo.repo?.path;
  if (!repoPath)
  {
    return;
  }
  loading.value = true;
  try
  {
    blobs.value = await api['conflicts:readBlobs'](repoPath, props.filePath);
  }
  finally
  {
    loading.value = false;
  }
}

/**
 * Who each side is, and their history on this path: additional to `load`, never
 * blocking it, so a slow blame leaves toolbars without attribution, not the window without an editor.
 */
async function loadMeta(): Promise<void>
{
  const repoPath = repo.repo?.path;
  if (!repoPath)
  {
    return;
  }
  let resolved: ConflictSides | null;
  try
  {
    resolved = await api['conflicts:readSides'](repoPath);
  }
  catch
  {
    resolved = null;
  }
  sidesRefs.value = resolved;

  async function blameSide(
    path: string,
    ref_: ConflictSideRef | null | undefined
  ): Promise<BlameFile | null>
  {
    // No commit, nothing to blame: an `am`'s incoming side is a patch (see `sideSubtitle`).
    if (!ref_?.sha)
    {
      return null;
    }
    const sha = ref_.sha;
    try
    {
      return await api['file:blame'](
        path,
        { kind: ENDPOINT_KIND_COMMIT, sha },
        props.filePath
      );
    }
    catch
    {
      // The path may not exist at this side's commit: added fresh by the other side.
      return null;
    }
  }

  [oursBlame.value, theirsBlame.value] = await Promise.all([
    blameSide(repoPath, resolved?.ours),
    blameSide(repoPath, resolved?.theirs)
  ]);
  // Blame arrived after the toolbars were built; give them attribution now.
  rebuildZones();
}

// ── The editable result, with a toolbar over each remaining conflict ───────

/**
 * A block button's tooltip: the legend's word, then what it means. Role first: a
 * tooltip and legend using different words for one button leaves the icon belonging to neither.
 */
function sideLabel(side: 'ours' | 'theirs'): string
{
  const entry = sides.value.find((candidate) => candidate.side === side);
  if (!entry)
  {
    return side;
  }
  return `${entry.role}: ${entry.describe}`;
}

/**
 * Replace the whole model with `next`. `pushEditOperations`, not `setValue`: the
 * latter clears undo history, and an accidental click should be one Cmd-Z away.
 */
function replaceAll(next: string): void
{
  const model = resultEditor?.getModel();
  if (!model)
  {
    return;
  }
  const full = new monaco.Range(
    1,
    1,
    model.getLineCount(),
    model.getLineMaxColumn(model.getLineCount())
  );
  model.pushEditOperations([], [{ range: full, text: next }], () => null);
}

function acceptBlock(block: ConflictBlock, choice: ConflictChoice): void
{
  const model = resultEditor?.getModel();
  if (!model)
  {
    return;
  }
  replaceAll(resolveConflictBlock(model.getValue(), block, choice, baseLines.value));
}

/**
 * Splice a word-level merge into one block. Not a `ConflictChoice`: those five are
 * "take this side"; this one's replacement is computed from the base and arrives already decided.
 */
function acceptMerged(block: ConflictBlock, mergedLines: readonly string[]): void
{
  const model = resultEditor?.getModel();
  if (!model)
  {
    return;
  }
  const lines = model.getValue().split('\n');
  lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...mergedLines);
  replaceAll(lines.join('\n'));
}

/**
 * Every block a word-level merge could settle, keyed by its index in `remainingBlocks`.
 * Recomputed with the zones: an edit changes which blocks can still be merged.
 */
const autoMergeable = ref<Map<number, string[]>>(new Map());

/** Settle every block that can be settled, back to front so each splice leaves later line numbers untouched. */
function acceptAllMerged(): void
{
  const model = resultEditor?.getModel();
  if (!model)
  {
    return;
  }
  const blocks = remainingBlocks.value;
  const lines = model.getValue().split('\n');
  const indexes = [...autoMergeable.value.keys()].sort((a, b) => b - a);
  for (const index of indexes)
  {
    const block = blocks[index];
    const merged = autoMergeable.value.get(index);
    if (!block || !merged)
    {
      continue;
    }
    lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...merged);
  }
  replaceAll(lines.join('\n'));
}

/** "Mine: Alice, 2 days ago, 'swap salt for vanilla'", for one side of one block. */
/**
 * The gutter strip and line tint for one stretch of a block. `marginClassName` colours
 * the gutter (readable while scrolling); `className` is the faint tint under the text.
 */
function decorationFor(kind: ConflictRegionKind): monaco.editor.IModelDecorationOptions
{
  const options: monaco.editor.IModelDecorationOptions = {
    isWholeLine: true,
    className: `gitext-conflict-line gitext-conflict-line--${kind}`,
    marginClassName: `gitext-conflict-margin gitext-conflict-margin--${kind}`
  };
  if (kind === REGION_MARKER)
  {
    options.inlineClassName = 'gitext-conflict-text--marker';
  }
  return options;
}

function rebuildZones(): void
{
  if (!resultEditor)
  {
    return;
  }
  const model = resultEditor.getModel();
  if (!model)
  {
    return;
  }
  const text = model.getValue();
  const blocks = parseConflictBlocks(text);
  remainingBlocks.value = blocks;
  // Not `blocks.length`: a half-deleted block parses as nothing while its opener
  // remains. See `hasConflictMarkers`.
  markersRemain.value = hasConflictMarkers(text);

  // To the end of the line, not column 1: `isWholeLine` covers the background either
  // way, but a marker's `inlineClassName` needs the range to actually contain its text.
  resultDecorations?.set(
    conflictRegions(blocks).map((region) => ({
      range: new monaco.Range(
        region.startLine,
        1,
        region.endLine,
        model.getLineMaxColumn(region.endLine)
      ),
      options: decorationFor(region.kind)
    }))
  );

  // Against the text as it stands now: accepting one block or typing in another
  // changes which of the rest can still be merged.
  const merges = new Map<number, string[]>();
  for (const suggestion of suggestAutoMerges(text, blocks, blobs.value?.base ?? null))
  {
    merges.set(suggestion.blockIndex, suggestion.mergedLines);
  }
  autoMergeable.value = merges;

  // Blamed once per rebuild, not per block: `findLineRange` walks each blob once,
  // carrying the cursor forward, so a repeated line elsewhere can't match the wrong occurrence.
  const oursBlob = blobs.value?.ours?.split('\n') ?? [];
  const theirsBlob = blobs.value?.theirs?.split('\n') ?? [];
  let oursCursor = 0;
  let theirsCursor = 0;

  resultEditor.changeViewZones((accessor) =>
  {
    for (const id of zoneIds)
    {
      accessor.removeZone(id);
    }
    zoneIds = [];
    blocks.forEach((block, index) =>
    {
      let oursCommit: BlameCommitInfo | null = null;
      const oursRange = findLineRange(oursBlob, block.oursLines, oursCursor);
      if (oursRange)
      {
        oursCursor = oursRange.end + 1;
        if (oursBlame.value)
        {
          oursCommit = commitForLines(oursBlame.value, oursRange.start + 1, oursRange.end + 1);
        }
      }
      let theirsCommit: BlameCommitInfo | null = null;
      const theirsRange = findLineRange(theirsBlob, block.theirsLines, theirsCursor);
      if (theirsRange)
      {
        theirsCursor = theirsRange.end + 1;
        if (theirsBlame.value)
        {
          theirsCommit = commitForLines(theirsBlame.value, theirsRange.start + 1, theirsRange.end + 1);
        }
      }

      let heightInPx = TOOLBAR_ROW_PX;
      if (oursCommit || theirsCommit)
      {
        heightInPx += TOOLBAR_ATTRIBUTION_ROW_PX;
      }
      const id = accessor.addZone({
        afterLineNumber: block.startLine - 1,
        heightInPx,
        domNode: buildBlockToolbar({
          block,
          index,
          total: blocks.length,
          oursLabel: sideLabel(SIDE_OURS),
          theirsLabel: sideLabel(SIDE_THEIRS),
          oursRole: oursRole.value,
          theirsRole: theirsRole.value,
          oursCommit,
          theirsCommit,
          merged: merges.get(index),
          hasBase: baseLines.value !== null,
          onChoose: acceptBlock,
          onMerged: acceptMerged
        })
      });
      zoneIds.push(id);
    });
  });
}

/** One rebuild per frame, however many keystrokes landed in it: the same coalescing
 *  `DialogFrame` uses, since a rebuild mid-character is work nobody's waiting on. */
function scheduleZoneRebuild(): void
{
  if (zoneRebuildPending)
  {
    return;
  }
  zoneRebuildPending = true;
  requestAnimationFrame(() =>
  {
    zoneRebuildPending = false;
    rebuildZones();
  });
}

function layoutResult(): void
{
  const el = resultHost.value;
  if (el && resultEditor)
  {
    resultEditor.layout({ width: el.clientWidth, height: el.clientHeight });
  }
}

function createResultEditor(): void
{
  const current = blobs.value;
  if (!resultHost.value || !current)
  {
    return;
  }
  initialWorking = current.working;
  resultEditor = monaco.editor.create(resultHost.value, {
    value: current.working,
    language: language.value,
    theme: monacoThemeName(effectiveTheme.value),
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    lineNumbers: 'on',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONT_FAMILY,
    padding: { top: 4, bottom: 4 },
    stickyScroll: { enabled: false }
  });
  resultDecorations = resultEditor.createDecorationsCollection([]);
  resultResize = new ResizeObserver(layoutResult);
  resultResize.observe(resultHost.value);
  resultEditor.onDidChangeModelContent(scheduleZoneRebuild);
  rebuildZones();
}

// ── Mount / theme / teardown ────────────────────────────────────────────────

onMounted(async () =>
{
  // Never awaited alongside `load`: blame can be slow, and opening the editor needs
  // none of it (see `loadMeta`).
  void loadMeta();
  await load();
  const current = blobs.value;
  if (!current)
  {
    return;
  }
  if (parseConflictBlocks(current.working).length === 0)
  {
    noMarkersAtAll.value = true;
    return;
  }
  await nextTick();
  referencePanes.create();
  createResultEditor();
});

watch(effectiveTheme, (theme) =>
{
  applyMonacoTheme(theme);
});

onUnmounted(() =>
{
  resultResize?.disconnect();
  resultDecorations = null;
  resultEditor?.getModel()?.dispose();
  resultEditor?.dispose();
});

// ── Finishing ────────────────────────────────────────────────────────────────

async function requestClose(): Promise<void>
{
  if (!resultEditor || resultEditor.getValue() === initialWorking)
  {
    emit('close');
    return;
  }
  const confirmed = await ui.confirm({
    title: 'Discard changes to this conflict?',
    message: 'It has been edited but not saved. Closing loses the edit.',
    confirmLabel: 'Discard',
    danger: true
  });
  if (confirmed)
  {
    emit('close');
  }
}

async function save(): Promise<void>
{
  const text = resultEditor?.getValue();
  if (text === undefined)
  {
    return;
  }
  const wrote = await perform(
    `Saving ${props.filePath}`,
    async (repoPath) =>
    {
      await api['conflicts:writeResolved'](repoPath, props.filePath, text);
    },
    { refresh: false, close: false }
  );
  if (!wrote)
  {
    return;
  }
  // Staging is its own step through `git:run`, so the log shows the write and the `git
  // add` separately. Default options refresh every window, close this, and re-raise the
  // resolver if conflicts remain elsewhere.
  await run(buildMarkResolvedArgs([props.filePath]), STAGING);
}
</script>

<template>
  <DialogFrame :title="`Resolve Conflict, ${filePath}`" fixed-height @close="requestClose">
    <div class="form fills">
      <p v-if="loading" class="placeholder">Reading…</p>

      <p v-else-if="noMarkersAtAll" class="hint">
        No inline markers: added or deleted on one side. Use Keep Ours or Keep Theirs.
      </p>

      <template v-else>
        <p class="summary">
          <span class="count">{{ remainingBlocks.length }}</span>
          {{ remainingBlocks.length === 1 ? 'conflict' : 'conflicts' }} remaining:
          <!-- The role carries the colour its lines are drawn in below, the only place the gutter's hues are named. -->
          <template v-for="(side, index) in sides" :key="side.side">
            <template v-if="index">, </template>
            <strong class="role" :class="`role--${side.side}`">{{ side.role }}</strong>
            is {{ side.describe }}
          </template>
        </p>

        <!-- What the shapes on each block's toolbar mean; the toolbars have no room to say it themselves. -->
        <ConflictLegend :items="legendItems" />

        <!-- Offered, never done on its own: a word-level look says the two sides
             changed different words and don't actually collide. Still reviewable
             below, and Cmd-Z puts any of it back. -->
        <p v-if="autoMergeable.size" class="auto">
          <ConflictIcon name="autoMerge" />
          <span>
            {{ autoMergeable.size }} of {{ remainingBlocks.length }}
            {{ remainingBlocks.length === 1 ? 'conflict' : 'conflicts' }} can be merged
            automatically: the two sides changed different words of the same lines.
          </span>
          <button type="button" @click="acceptAllMerged">
            Merge {{ autoMergeable.size === 1 ? 'it' : 'them all' }}
          </button>
        </p>

        <div class="panes">
          <div class="pane">
            <p class="pane-label" :title="sideSubtitle(sidesRefs?.ours ?? null, oursLatest)">
              Base → {{ oursRole }}{{ baseLines === null ? ' (no common ancestor)' : '' }}
              <span v-if="sidesRefs?.ours" class="pane-label__meta">
               · {{ sideSubtitle(sidesRefs.ours, oursLatest) }}
              </span>
            </p>
            <div :ref="referencePanes.setOursHost" class="pane-host" />
          </div>
          <div class="pane">
            <p class="pane-label" :title="sideSubtitle(sidesRefs?.theirs ?? null, theirsLatest)">
              Base → {{ theirsRole }}{{ baseLines === null ? ' (no common ancestor)' : '' }}
              <span v-if="sidesRefs?.theirs" class="pane-label__meta">
               · {{ sideSubtitle(sidesRefs.theirs, theirsLatest) }}
              </span>
            </p>
            <div :ref="referencePanes.setTheirsHost" class="pane-host" />
          </div>
        </div>

        <div class="result">
          <div ref="resultHost" class="result-host" />
        </div>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="requestClose">{{ noMarkersAtAll ? 'Close' : 'Cancel' }}</button>
      <button
        v-if="!noMarkersAtAll"
        class="primary"
        :disabled="busy || loading || markersRemain"
        :title="markersRemain ? 'Resolve every conflict block below first' : undefined"
        @click="save"
      >
        {{ busy ? 'Saving…' : 'Save & Mark Resolved' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/conflictSummary.css"></style>
<style scoped>

/* Fixed height in a column that stretches: the editor below takes what is left. */
.summary { flex: none; }

/* A swatch, not a coloured word: the hues sit *behind* text and would be unreadable on it. */
.role::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 2px;
  vertical-align: baseline;
}

.role--ours::before { background: var(--conflict-ours-bar); }
.role--theirs::before { background: var(--conflict-theirs-bar); }

/* An offer, drawn as one: a tinted strip with the action at its end, not a warning or banner. */
.auto {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  margin: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.auto span {
  flex: 1;
  min-width: 0;
}

.auto button {
  flex: none;
  font-size: var(--text-xs);
  padding: 1px var(--space-2);
}

.panes {
  display: flex;
  gap: var(--space-3);
  flex: none;
  height: 200px;
}

.pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.pane-label {
  margin: 0;
  padding: 2px var(--space-2);
  flex: none;
  font-size: var(--text-xs);
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-label__meta {
  color: var(--fg-subtle);
}

.pane-host {
  flex: 1;
  min-height: 0;
}

.result {
  flex: 1;
  min-height: 0;
  display: flex;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.result-host {
  flex: 1;
  min-width: 0;
}
</style>

<!--
  Unscoped, deliberately: `changeViewZones` hands Monaco a raw DOM node outside Vue's
  render tree, so a scoped block's `data-v-*` selector never matches it. `gitext-` prefixed to stay clear of the rest of the app.
-->
<style>
/* The gutter strip: a bar in the block's colour over a tint of the same hue across the
   line-number column, readable while scrolling. An inset shadow, not a border, so it costs the margin no width. */
.gitext-conflict-margin--ours {
  background: var(--conflict-ours-bg);
  box-shadow: inset 3px 0 0 var(--conflict-ours-bar);
}

.gitext-conflict-margin--theirs {
  background: var(--conflict-theirs-bg);
  box-shadow: inset 3px 0 0 var(--conflict-theirs-bar);
}

.gitext-conflict-margin--base {
  background: var(--conflict-base-bg);
  box-shadow: inset 3px 0 0 var(--conflict-base-bar);
}

.gitext-conflict-margin--marker {
  background: var(--conflict-marker-bg);
  box-shadow: inset 3px 0 0 var(--conflict-marker-bar);
}

/* The line itself: a flat background behind the text, which keeps its own syntax colours. */
.gitext-conflict-line--ours { background: var(--conflict-ours-bg); }
.gitext-conflict-line--theirs { background: var(--conflict-theirs-bg); }
.gitext-conflict-line--base { background: var(--conflict-base-bg); }
.gitext-conflict-line--marker { background: var(--conflict-marker-bg); }

/* A marker's own text, recoloured: left to the tokenizer, `=======` reads as a
   markdown heading and `<<<<<<<` as an operator. Colour only, never advance width, so
   the line stays in step with Monaco's own metrics. Long selector to outweigh
   `.monaco-editor.<theme> .mtk1`, which comes later in the document. */
.monaco-editor .view-lines span.gitext-conflict-text--marker {
  color: var(--conflict-marker-bar);
}

.gitext-conflict-toolbar {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 0 8px;
  background: var(--bg-subtle);
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  /*
   * `.view-lines` is a later sibling of `.view-zones` inside Monaco's `.lines-content`,
   * both `position: absolute`, so it paints over a zone and hit-tests as opaque across
   * the gap a zone occupies. Only a positive `z-index` lifts this out of DOM-order painting.
   */
  position: relative;
  z-index: 10;
  pointer-events: auto;
}

.gitext-conflict-toolbar__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.gitext-conflict-toolbar__label {
  margin-right: auto;
  color: var(--fg-muted);
}

/* Icon buttons: square-ish, quiet until hovered, so five read as one control strip. */
.gitext-conflict-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 5px;
  border: 1px solid transparent;
  background: none;
  color: var(--fg-muted);
}

.gitext-conflict-toolbar button:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--fg);
}

.gitext-conflict-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

/* A second, quieter row: reads as detail under the decision, not another competing thing. */
.gitext-conflict-toolbar__attribution {
  color: var(--fg-subtle);
  font-size: 10px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
