<script setup lang="ts">
/**
 * What is still conflicted, and what to do about each one. Every action sits on the
 * row it acts on, never on "the selection", so a row's own button is never ambiguous.
 *
 * The words come from the operation, never from git: "ours"/"theirs" flip meaning
 * mid-rebase, so buttons say `Mine`/`Incoming` or `Base`/`Mine` (`describeSides`); the ref name stays in the tooltip.
 */

import { computed, onMounted, ref, watch } from 'vue';
import type { DiffFileEntry } from '@shared/diff.js';
import { FILE_STATUS_CONFLICTED } from '@shared/types.js';
import {
  buildMarkResolvedArgs,
  buildMergetoolArgs,
  buildTakeAllSideSteps,
  buildTakeSideSteps,
  describeSides,
  operationInfo,
  type ConflictSide
} from '@renderer/model/args/conflicts.js';
import {
  ROW_KIND_FILE as ROW_FILE,
  ROW_KIND_FOLDER as ROW_FOLDER,
  VIEW_FLAT,
  VIEW_TREE,
  buildFileRows,
  filesInRow,
  type FileRow
} from '@renderer/filetree.js';
import { createCollapsedFolders } from '@renderer/collapsedFolders.js';
import Glyph from '@renderer/components/ui/Glyph.vue';
import Twisty from '@renderer/components/ui/Twisty.vue';
import SegmentedSwitch, {
  type SegmentedItem
} from '@renderer/components/ui/SegmentedSwitch.vue';
import { STATUS_LETTER } from '@renderer/model/fileRowDescription.js';
import { nothingToResolve } from '@renderer/model/conflictWindow.js';
import {
  EMPTY_SELECTION,
  MODE_RANGE as PICK_RANGE,
  MODE_REPLACE as PICK_REPLACE,
  MODE_TOGGLE as PICK_TOGGLE,
  pickPath,
  pickPaths,
  type PathSelection,
  type SelectMode
} from '@renderer/pathSelection.js';
import { api } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useContextMenu } from '@renderer/composables/useContextMenu.js';
import {
  conflictRowMenu,
  CONFLICT_MENU_MERGETOOL,
  CONFLICT_MENU_RESOLVED,
  CONFLICT_MENU_RESOLVE_HERE
} from '@renderer/menus/conflicts.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import ConflictIcon from '@renderer/components/ui/ConflictIcon.vue';
import ConflictLegend from '@renderer/components/ui/ConflictLegend.vue';
import type { ConflictIconName } from '@renderer/components/ui/conflictIcons.js';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE, STAGING } from '@shared/invalidation.js';
import {
  OBJECT_KIND_BLOB as ENTRY_KIND_BLOB,
  OPERATION_CHERRY_PICK as OP_CHERRY_PICK,
  OPERATION_MERGE as OP_MERGE,
  OPERATION_NONE,
  OPERATION_REBASE as OP_REBASE,
  OPERATION_REVERT as OP_REVERT,
  type ConflictSides
} from '@shared/types.js';

const WORKTREE_AND_INDEX = ['worktree', 'index'] as const;


const SIDE_OURS: ConflictSide = 'ours';

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const ui = useUiStore();
// The selection-scoped actions pass `{ close: false }`: resolving some of the files is
// not finishing the operation, and the list has to still be there for the next pick.
const { busy, error, run, runSteps, close } = useDialog();

const state = computed(() => repo.state);
const conflicts = computed(() => state.value.conflictedPaths);
const info = computed(() => operationInfo(state.value.operation));
const opLabel = computed(() => info.value?.label ?? state.value.operation);

/** A rebase swaps what the two words mean, so the wording is chosen from the operation. */
const rebasing = computed(() => state.value.operation === OP_REBASE);

const sides = computed(() => describeSides(rebasing.value));

/**
 * Which real commit each side is, so a button can say `Keep salty`. Read once on
 * mount; absent for good on an `am`, which has no ref for its incoming side.
 */
const sidesRefs = ref<ConflictSides | null>(null);

/**
 * The ref this side actually is, for the legend line, never for a button. `''` when
 * git resolved none: an `am`'s incoming side is a patch, not a commit.
 */
function sideName(side: ConflictSide): string
{
  let entry;
  if (side === SIDE_OURS)
  {
    entry = sidesRefs.value?.ours;
  }
  else
  {
    entry = sidesRefs.value?.theirs;
  }
  return entry?.name ?? '';
}

// ── Picking files ─────────────────────────────────────────────────────────────
// Same shapes `StagingList` and the file pane draw from (`FileRow`/`buildFileRows`,
// `PathSelection`/`pickPath`/`pickPaths`), flat by default for the same reason. An
// empty pick means "every file still conflicted".

/** Conflicted paths as `DiffFileEntry`s, so they draw through the shape every other
 *  file list uses: `conflicted` is already `STATUS_LETTER`'s `U`. */
const files = computed<DiffFileEntry[]>(() =>
  conflicts.value.map((path) => ({
    path,
    status: FILE_STATUS_CONFLICTED,
    score: 0,
    kind: ENTRY_KIND_BLOB,
    mode: '',
    binary: false
  }))
);

/** List or tree, the same switch `ChangedFiles`/`StagingList` offer, flat by default. */
const view = ref<typeof VIEW_FLAT | typeof VIEW_TREE>(VIEW_FLAT);

/**
 * The switch's two answers. Local state rather than registry commands: this window has
 * its own view, and the pane's setting is not what it is asking about.
 */
const viewItems = computed<SegmentedItem[]>(() => [
  { id: VIEW_FLAT, label: 'Show as a list', enabled: true, checked: view.value === VIEW_FLAT },
  {
    id: VIEW_TREE,
    label: 'Show as a tree of folders',
    enabled: true,
    checked: view.value === VIEW_TREE
  }
]);

function setView(id: string): void
{
  if (id === VIEW_TREE)
  {
    view.value = VIEW_TREE;
  }
  else
  {
    view.value = VIEW_FLAT;
  }
}

const folders = createCollapsedFolders(() => files.value, () => false);

const rows = computed<FileRow<DiffFileEntry>[]>(() =>
  buildFileRows(files.value, { view: view.value, dense: false, collapsed: folders.keys.value })
);

const picked = ref<PathSelection>(EMPTY_SELECTION);
const pickedSet = computed<ReadonlySet<string>>(() => new Set(picked.value.picks));

/** A file that resolves leaves `conflicts` on its own; drop it out of the pick with it. */
watch(conflicts, (paths) =>
{
  const live = new Set(paths);
  if (picked.value.picks.every((path) => live.has(path)))
  {
    return;
  }
  const picks = picked.value.picks.filter((path) => live.has(path));
  let anchor;
  if (picked.value.anchor && live.has(picked.value.anchor))
  {
    anchor = picked.value.anchor;
  }
  else
  {
    anchor = picks.at(-1) ?? null;
  }
  picked.value = { picks, anchor };
});

/**
 * Nothing left to resolve and no operation to continue (`nothingToResolve`). Watches
 * the value, not the transition: the raise is async, so an operation that finishes while
 * this window is still loading needs to close anyway. Closing waits for a stacked dialog (`main/dialogs.ts`).
 */
watch(
  () => nothingToResolve(state.value.operation, conflicts.value.length),
  (finished) =>
  {
    if (finished)
    {
      close();
    }
  },
  { immediate: true }
);

function filesUnder(key: string): string[]
{
  return filesInRow(files.value, key).map((file) => file.path);
}

/** A folder is picked when everything in it is: there is no half-tick here. */
function isFolderPicked(key: string): boolean
{
  const paths = filesUnder(key);
  return paths.length > 0 && paths.every((path) => pickedSet.value.has(path));
}

/** Past one file, same rule `StagingList` draws: a single-file folder lighting up would say nothing new. */
function isFolderHighlighted(key: string): boolean
{
  return filesUnder(key).length > 1 && isFolderPicked(key);
}

function onRowClick(row: FileRow<DiffFileEntry>, event: MouseEvent): void
{
  if (row.kind === ROW_FOLDER)
  {
    if (event.metaKey || event.ctrlKey)
    {
      picked.value = pickPaths(picked.value, filesUnder(row.key), PICK_TOGGLE);
    }
    else if (event.shiftKey)
    {
      picked.value = pickPaths(picked.value, filesUnder(row.key), PICK_REPLACE);
    }
    else
    {
      folders.toggle(row.key);
    }
    return;
  }
  let mode: SelectMode;
  if (event.shiftKey)
  {
    mode = PICK_RANGE;
  }
  else if (event.metaKey || event.ctrlKey)
  {
    mode = PICK_TOGGLE;
  }
  else
  {
    mode = PICK_REPLACE;
  }
  const order = rows.value.filter((r) => r.kind === ROW_FILE).map((r) => r.key);
  picked.value = pickPath(picked.value, row.key, mode, order);
}

/**
 * Double-click opens the built-in editor, not `git mergetool`: it always works,
 * unlike a tool that depends on `merge.tool` being configured. The external tool is still a button away.
 */
function openRow(row: FileRow<DiffFileEntry>): void
{
  if (row.kind !== ROW_FILE)
  {
    return;
  }
  resolveHere(row.key);
}

/** Nothing picked reads as "every file still conflicted" everywhere below. */
const effectivePaths = computed<string[]>(() =>
{
  if (picked.value.picks.length > 0)
  {
    return conflicts.value.filter((path) => pickedSet.value.has(path));
  }
  else
  {
    return conflicts.value;
  }
}
);

const wholeListPicked = computed(
  () => picked.value.picks.length === 0 || effectivePaths.value.length === conflicts.value.length
);

/**
 * What every button below acts on, said once above them rather than in each label:
 * the count belongs to the row, not to the choice.
 */
const scopeLabel = computed(() =>
{
  const total = conflicts.value.length;
  if (wholeListPicked.value)
  {
    if (total === 1)
    {
      return 'the 1 conflicted file';
    }
    return `all ${total} conflicted files`;
  }
  return `${effectivePaths.value.length} of ${total} picked`;
});

/** Which icon stands for a side: filled is the side you're on, outlined is incoming (`conflictIcons.ts`). */
function sideIcon(side: ConflictSide): ConflictIconName
{
  if (side === SIDE_OURS)
  {
    return 'keepMine';
  }
  return 'keepIncoming';
}

/**
 * The legend for the row buttons, built from the same `sides` table so picture and
 * word can't drift. No ref name: that's what the tooltip is for.
 */
const legendItems = computed<{ icon: ConflictIconName; label: string }[]>(() =>
{
  const forSides = sides.value.map((entry) => ({
    icon: sideIcon(entry.side),
    label: `Keep ${entry.role}`
  }));
  return [
    ...forSides,
    { icon: 'resolve' as const, label: 'Resolve here' },
    { icon: 'mergetool' as const, label: 'Merge tool' },
    { icon: 'markResolved' as const, label: 'Mark resolved' }
  ];
});

/**
 * Everything an icon and a one-word label leave out: the ref, git's own flag, and the
 * target. The only place a branch name appears; hovering is how you ask which branch it is.
 */
function sideTitle(entry: (typeof sides.value)[number], target: string): string
{
  const name = sideName(entry.side);
  let which = entry.describe;
  if (name)
  {
    which = `${name}, ${entry.describe}`;
  }
  return `Keep ${which}, git's --${entry.side}, for ${target}`;
}

// ── The preview strip ─────────────────────────────────────────────────────────
// Follows the pointer, not one-per-row: a picked subset has no fixed row count to sit under.

const hovered = ref<string[] | null>(null);

const keepArgv = (side: ConflictSide, paths: readonly string[]): string[] =>
{
  if (paths.length === 0)
  {
    return [];
  }
  if (paths.length === 1)
  {
    return buildTakeSideSteps(side, paths[0]!)[0]?.argv ?? [];
  }
  else
  {
    return buildTakeAllSideSteps(side, paths)[0]?.argv ?? [];
  }
};

/**
 * A merge, cherry-pick or revert finishes with a commit, not a bare `--continue`
 * (`continueOp`). No single argv to preview for "open the commit screen".
 */
const opensCommitScreen = computed(
  () =>
    info.value !== null &&
    (state.value.operation === OP_MERGE ||
      state.value.operation === OP_CHERRY_PICK ||
      state.value.operation === OP_REVERT)
);

const previewArgv = computed(() =>
{
  if (hovered.value)
  {
    return hovered.value;
  }
  if (opensCommitScreen.value)
  {
    return [];
  }
  else
  {
    return info.value?.continueArgv ?? [];
  }
});

const previewPlaceholder = computed(() =>
{
  if (opensCommitScreen.value)
  {
    return 'Continue opens the commit screen with the prepared message';
  }
  else
  {
    return 'Nothing in progress';
  }
}
);

// ── The four actions ─────────────────────────────────────────────────────────
// Every one takes the paths it acts on as an argument, not the selection: that's what
// lets a row's own buttons and the bulk row below share them unambiguously.

/**
 * Keep one side of `paths`. Confirmed only past one file: a single file has an
 * obvious undo, but this can overwrite several unlooked-at files in one click with nothing to bring them back.
 */
async function keepSide(side: ConflictSide, paths: readonly string[]): Promise<void>
{
  if (paths.length === 0)
  {
    return;
  }
  if (paths.length === 1)
  {
    await runSteps(buildTakeSideSteps(side, paths[0]!), WORKTREE_AND_INDEX, { close: false });
    return;
  }
  const describe = sides.value.find((entry) => entry.side === side)?.describe ?? side;
  const ok = await ui.confirm({
    title: `Keep ${describe} for ${paths.length} files?`,
    message: `Every one of these files is overwritten with its ${side} version and marked resolved. What the other side changed in them is discarded, and nothing here can bring it back.`,
    confirmLabel: 'Keep that side',
    danger: true
  });
  if (!ok)
  {
    return;
  }
  await runSteps(buildTakeAllSideSteps(side, paths), WORKTREE_AND_INDEX, { close: false });
}

/** Hand one file to the built-in three-way editor: no "edit these twelve" version exists. */
function resolveHere(path: string | undefined): void
{
  if (path)
  {
    ui.openDialog('conflicts.editFile', { filePath: path });
  }
}

async function openInMergetool(paths: readonly string[]): Promise<void>
{
  if (paths.length === 0)
  {
    return;
  }
  await run(buildMergetoolArgs([...paths]), WORKTREE_AND_INDEX, { close: false });
}

async function markResolved(paths: readonly string[]): Promise<void>
{
  if (paths.length === 0)
  {
    return;
  }
  if (paths.length > 1)
  {
    const ok = await ui.confirm({
      title: `Mark ${paths.length} files resolved as they stand?`,
      message:
        'Commits the working tree as it is. Neither side is checked again.',
      confirmLabel: 'Mark resolved',
      danger: true
    });
    if (!ok)
    {
      return;
    }
  }
  await run(buildMarkResolvedArgs([...paths]), STAGING, { close: false });
}

const { menu, openFrom, close: closeMenu } = useContextMenu();

function onRowContextMenu(row: FileRow<DiffFileEntry>, event: MouseEvent): void
{
  event.preventDefault();
  if (row.kind === ROW_FOLDER)
  {
    if (!isFolderPicked(row.key))
    {
      picked.value = pickPaths(picked.value, filesUnder(row.key), 'replace');
    }
  }
  else if (!pickedSet.value.has(row.key))
  {
    picked.value = { picks: [row.key], anchor: row.key };
  }
  openFrom(event, conflictRowMenu(effectivePaths.value));
}

function onListBackgroundContextMenu(event: MouseEvent): void
{
  event.preventDefault();
  openFrom(event, conflictRowMenu(effectivePaths.value));
}

async function onMenuCommand(id: string): Promise<void>
{
  closeMenu();
  const paths = effectivePaths.value;
  switch (id)
  {
    case CONFLICT_MENU_MERGETOOL:
      await openInMergetool(paths);
      break;
    case CONFLICT_MENU_RESOLVE_HERE:
      resolveHere(paths[0]);
      break;
    case CONFLICT_MENU_RESOLVED:
      await markResolved(paths);
      break;
    default:
      break;
  }
}

// ── Finishing the operation ──────────────────────────────────────────────────

/**
 * A merge/cherry-pick/revert hands off to the commit screen rather than running blind:
 * `readMessageFile` fills its message from `MERGE_MSG`. `rebase`/`am` keep running `--continue` directly.
 */
async function continueOp(): Promise<void>
{
  if (!info.value)
  {
    return;
  }
  if (conflicts.value.length > 0)
  {
    error.value = 'Resolve every conflict before continuing.';
    return;
  }
  if (opensCommitScreen.value)
  {
    close();
    ui.openDialog('commit.open');
    return;
  }
  await run(info.value.continueArgv, HISTORY_MOVE);
}

async function abortOp(): Promise<void>
{
  if (info.value)
  {
    await run(info.value.abortArgv, HISTORY_MOVE);
  }
}

onMounted(async () =>
{
  await repo.refresh();
  const repoPath = repo.repo?.path;
  if (!repoPath)
  {
    return;
  }
  try
  {
    sidesRefs.value = await api['conflicts:readSides'](repoPath);
  }
  catch
  {
    // The legend just drops its ref names; nothing here is worth an error over.
  }
});
</script>

<template>
  <DialogFrame :title="`Solve Merge Conflicts · ${opLabel} in progress`" @close="emit('close')">
    <div class="content">
      <p class="summary">
        <span class="count">{{ conflicts.length }}</span>
        {{ conflicts.length === 1 ? 'conflict' : 'conflicts' }} remaining.
      </p>

      <!-- Which side is which, spelled out: what an icon and a role word both leave
           out, and what a rebase makes genuinely treacherous. -->
      <p v-if="conflicts.length" class="hint">
        <template v-for="(side, index) in sides" :key="side.side">
          <template v-if="index"> · </template>
          <strong>{{ side.role }}</strong> is {{ side.describe }}
        </template>
      </p>

      <!-- Directly above the rows it explains, so the eye never leaves the list.
           Right-aligned, so it reads as a key to the list, not another line of prose. -->
      <div v-if="conflicts.length" class="legend-row">
        <ConflictLegend :items="legendItems" />
      </div>

      <!-- Click/Shift/Ctrl to pick any subset, drawn like every other file list. No
           per-row buttons for bulk actions: a picked few or all of them are the same
           "list of paths" to every action below. -->
      <div v-if="conflicts.length" class="file-pane">
        <div class="bar">
          <SegmentedSwitch :items="viewItems" @run="setView">
            <template #icon="{ id }">
              <Glyph v-if="id === VIEW_FLAT" name="diffFile" />
              <Glyph v-else name="folder" />
            </template>
          </SegmentedSwitch>
          <span class="spacer" />
          <!-- What the buttons act on: here, not beside them, so the row below is just the buttons. -->
          <span class="picked">Acting on {{ scopeLabel }}</span>
        </div>

        <div class="rows" @contextmenu.self="onListBackgroundContextMenu">
          <template v-for="row in rows" :key="row.key">
            <div
              v-if="row.kind === ROW_FOLDER"
              class="row folder"
              :class="{ selected: isFolderHighlighted(row.key) }"
              :style="{ paddingLeft: `${row.depth * 12 + 8}px` }"
              :title="`${row.label}, click to fold, Shift-click to pick its files`"
              @click="onRowClick(row, $event)"
              @contextmenu="onRowContextMenu(row, $event)"
            >
              <Twisty :open="row.expanded" />
              <span class="path">{{ row.label }}</span>
              <span class="count">{{ row.count }}</span>
            </div>
            <div
              v-else
              class="row"
              :class="{ selected: pickedSet.has(row.key) }"
              :style="{ paddingLeft: `${row.depth * 12 + 8}px` }"
              :title="row.key"
              @click="onRowClick(row, $event)"
              @dblclick="openRow(row)"
              @contextmenu="onRowContextMenu(row, $event)"
            >
              <span class="letter">{{ STATUS_LETTER.conflicted }}</span>
              <span class="path">
                <span v-if="row.dir" class="dir">{{ row.dir }}</span>{{ row.label }}
              </span>

              <!-- On the row: the one thing every action must be unmistakable about
                   is which file. Icons, not labels; `.stop` so a click doesn't also
                   re-pick the row underneath it. -->
              <span class="row-actions">
                <button
                  v-for="side in sides"
                  :key="side.side"
                  type="button"
                  :data-side="side.side"
                  :disabled="busy"
                  :title="sideTitle(side, row.key)"
                  :aria-label="`Keep ${side.role} for ${row.key}`"
                  @click.stop="keepSide(side.side, [row.key])"
                  @mouseenter="hovered = keepArgv(side.side, [row.key])"
                  @mouseleave="hovered = null"
                >
                  <ConflictIcon :name="sideIcon(side.side)" />
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  :title="`Resolve ${row.key} here, the built-in three-way editor`"
                  :aria-label="`Resolve ${row.key} here`"
                  @click.stop="resolveHere(row.key)"
                >
                  <ConflictIcon name="resolve" />
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  :title="`Open ${row.key} in the configured merge tool`"
                  :aria-label="`Open ${row.key} in the merge tool`"
                  @click.stop="openInMergetool([row.key])"
                >
                  <ConflictIcon name="mergetool" />
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  :title="`Mark ${row.key} resolved, stage it exactly as it stands on disk`"
                  :aria-label="`Mark ${row.key} resolved`"
                  @click.stop="markResolved([row.key])"
                >
                  <ConflictIcon name="markResolved" />
                </button>
              </span>
            </div>
          </template>
        </div>
      </div>

      <p v-if="conflicts.length === 0 && state.operation !== OPERATION_NONE" class="success">
        Every conflict is resolved. Continue to finish the {{ opLabel.toLowerCase() }}.
      </p>

      <!-- Every action in one row: the two side buttons lead, the rest follow as
           buttons, not a fold, since "mark it resolved, I fixed it by hand" isn't rare. -->
      <!-- The bulk row, only past one file: with a single conflict its buttons would
           duplicate the row's own. Text, not icons: there's room to spell out what it acts on. -->
      <div v-if="conflicts.length > 1" class="actions">
        <span class="scope">{{ scopeLabel }}:</span>
        <button
          v-for="side in sides"
          :key="side.side"
          type="button"
          :data-side="side.side"
          :disabled="busy"
          :title="sideTitle(side, scopeLabel)"
          @click="keepSide(side.side, effectivePaths)"
          @mouseenter="hovered = keepArgv(side.side, effectivePaths)"
          @mouseleave="hovered = null"
        >
          <ConflictIcon :name="sideIcon(side.side)" />
          Keep {{ side.role }}
        </button>
        <button
          type="button"
          :disabled="busy"
          :title="`Open ${scopeLabel} in the configured merge tool`"
          @click="openInMergetool(effectivePaths)"
        >
          <ConflictIcon name="mergetool" />
          Merge tool
        </button>
        <button
          type="button"
          :disabled="busy"
          :title="`Stage ${scopeLabel} exactly as they stand on disk`"
          @click="markResolved(effectivePaths)"
        >
          <ConflictIcon name="markResolved" />
          Mark resolved
        </button>
      </div>

      <CommandPreview :argv="previewArgv" :placeholder="previewPlaceholder" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @run="onMenuCommand"
      @close="closeMenu"
    />

    <template #actions>
      <button v-if="info" class="danger" :disabled="busy" @click="abortOp">
        Abort {{ opLabel }}
      </button>
      <button
        v-if="info"
        class="primary"
        :disabled="busy || conflicts.length > 0"
        @click="continueOp"
      >
        {{ busy ? 'Running…' : `Continue ${opLabel}` }}
      </button>
      <button v-else @click="emit('close')">Close</button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/paneBar.css"></style>
<style scoped src="@renderer/styles/conflictSummary.css"></style>
<style scoped src="@renderer/styles/listRow.css"></style>
<style scoped>
.content { display: flex; flex-direction: column; gap: var(--space-3); }
/* The legend sits against the list's right edge; the legend itself wraps if it must. */
.legend-row {
  display: flex;
  justify-content: flex-end;
}

/* Same pane the file list and `StashDialog` draw, at conflict-list size: recessed
 * under the dialog's surface, `listRow.css`'s tint marks the row, same as every file list. */
.file-pane {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.picked {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

/* Trimmed to what a conflicted row needs: no move button, one status letter (every
 * row is `conflicted`). Capped and scrolling, not growing the window without bound. */
.rows {
  background: var(--bg);
  max-height: 260px;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 1px var(--space-2);
  font-size: var(--text-sm);
  cursor: default;
  user-select: none;
}

.count {
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.letter {
  font-family: var(--font-mono);
  width: 1.2em;
  text-align: center;
  flex: none;
  font-weight: 600;
  color: var(--danger);
}

.path {
  flex: 1;
  font-family: var(--font-mono);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Every action in one row, reading as acting on the list above rather than one row of
 * it. Buttons size to their labels, not equal width; wrapping folds a narrow window rather than clipping it. */
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* What the bulk row acts on, once, instead of inside each of its labels. */
.scope {
  margin-right: auto;
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

/* Always drawn, never on hover: a control found only under the pointer answers "which
 * file" for nobody. `flex: none` so the path column absorbs width, not the buttons. */
.row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  margin-left: var(--space-2);
}

.row-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 5px;
  border: 1px solid transparent;
  background: none;
  color: var(--fg-muted);
}

.row-actions button:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--fg);
}

.row-actions button:disabled {
  opacity: 0.4;
}
</style>
