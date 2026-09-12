<script setup lang="ts">
/**
 * Application root.
 *
 * Owns startup (settings, theme, reopening the last repo), subscribes to the
 * main-process event streams, and lays out the shell.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { reportUnhandledTo } from '@renderer/diagnostics.js';
import { registerCommands } from '@renderer/commands/index.js';
import { useAfterGitOperation } from '@renderer/composables/useAfterGitOperation.js';
import { useCommands } from '@renderer/composables/useCommands.js';
import { useMenuState } from '@renderer/composables/useMenuState.js';
import { isArtificialSha } from '@shared/artificial.js';
import { invalidateRepository } from '@renderer/composables/useRepositoryRefresh.js';
import { useRevealCommit } from '@renderer/composables/useRevealCommit.js';
import { usePaneSplitter } from '@renderer/composables/useSplitter.js';
import { useCommandLogStore } from '@renderer/stores/commandLog.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useNavigationStore } from '@renderer/stores/navigation.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { FILE_PANE_VIEW_FILE, resolveTheme, useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';

import CommitDetails from '@renderer/components/details/CommitDetails.vue';
import ChangedFiles from '@renderer/components/filelist/ChangedFiles.vue';
import DiffViewer from '@renderer/components/diff/DiffViewer.vue';
import BlobViewer from '@renderer/components/diff/BlobViewer.vue';
import LeftPanel from '@renderer/components/leftpanel/LeftPanel.vue';
import LeftPanelRail from '@renderer/components/leftpanel/LeftPanelRail.vue';
import RevisionGrid from '@renderer/components/revisiongrid/RevisionGrid.vue';
import CommandLogPanel from '@renderer/components/transparency/CommandLogPanel.vue';
import CommandPalette from '@renderer/components/CommandPalette.vue';
import HealthBanner from '@renderer/components/HealthBanner.vue';
import OperationBanner from '@renderer/components/OperationBanner.vue';
import Toolbar from '@renderer/components/toolbar/Toolbar.vue';
import PaneSplitter from '@renderer/components/ui/PaneSplitter.vue';
import StatusBar from '@renderer/components/StatusBar.vue';
import WelcomeScreen from '@renderer/components/WelcomeScreen.vue';
import ConfirmDialog from '@renderer/components/dialogs/ConfirmDialog.vue';
import ToastStack from '@renderer/components/ui/ToastStack.vue';

registerCommands();

const INFO_SIDE_LEFT = 'left';
const INFO_SIDE_RIGHT = 'right';

const settingsStore = useSettingsStore();
const repoStore = useRepoStore();
const objects = useRepoObjectsStore();
const revisions = useRevisionsStore();
const diffStore = useDiffStore();
const fileTreeStore = useFileTreeStore();
const log = useCommandLogStore();
const navigation = useNavigationStore();
const selection = useSelectionStore();
const ui = useUiStore();
const { context } = useCommands();
// The other direction of the menu wire: `useCommands` receives the ids it dispatches,
// this reports which of them can be clicked and which way each toggle is set.
useMenuState(context);
const { reveal } = useRevealCommit();

// Conflicts raise the resolver however they arrived: a dialog's own command surfaces
// its own, this is the other half (a terminal merge, a repo opened mid-conflict).
useAfterGitOperation().watchForConflicts();

const ready = ref(false);

// Both panes hang below a draggable divider and grow upward, so they share one
// composable rather than two copies of the same mouse bookkeeping.
const logPane = usePaneSplitter({
  initial: 260,
  min: 100,
  max: () => window.innerHeight - 200
});
// 220px is enough for a commit's metadata but not a patch, once the diff moved in beside the details.
const detailsPane = usePaneSplitter({
  initial: 320,
  min: 80,
  max: () => window.innerHeight - 240
});

// Which side of the grid the commit info sits on.
const infoSide = computed(() => settingsStore.settings.commitInfoPosition);
// Its width there. One splitter for both sides, since the divider changes edges with
// the side but the width does not: a second one would mean a second width.
const commitInfoPane = usePaneSplitter({
  initial: 320,
  min: 200,
  max: () => window.innerWidth - 400,
  edge: () =>
  {
    if (infoSide.value === INFO_SIDE_LEFT)
    {
      return 'right';
    }
    else
    {
      return 'left';
    }
  }
});
const fileListPane = usePaneSplitter({
  initial: 280,
  min: 140,
  max: () => window.innerWidth - 400,
  edge: 'right'
});

// The panel sits to the left of its divider, so it widens as the pointer moves right,
// and its width persists: unlike the two panes above, which are per-session.
const panelPane = usePaneSplitter({
  initial: settingsStore.settings.leftPanelWidth,
  min: 140,
  max: () => window.innerWidth - 320,
  edge: 'right',
  onEnd: (width) => void settingsStore.patch({ leftPanelWidth: width })
});

const unsubscribers: (() => void)[] = [];

/** Guards against the burst of focus events a window manager can send. */
let lastFocusReload = 0;

/**
 * Coming back to the window re-reads the working tree, nothing else. The watcher
 * watches `.git`, which the log and panel live in but an editor/build/script doesn't
 * touch. One facet, not a refresh-all: a 17k-commit grid reload is a real cost for a no-op.
 */
function onWindowFocus(): void
{
  if (!repoStore.repo)
  {
    return;
  }
  const now = Date.now();
  if (now - lastFocusReload < 400)
  {
    return;
  }
  lastFocusReload = now;
  invalidateRepository(['worktree']);
}

onMounted(async () =>
{
  // An error nobody caught used to reach the diagnostics ring and stop there: a line in a
  // file the user will never open, and visibly nothing at all. The repository window is
  // the one with a toast stack, so it is the one that shows them.
  reportUnhandledTo((message) => ui.toast(message, 'error'));

  // Everything in here runs before `ready` flips, and `ready` gates the whole window. A
  // rejection anywhere (an unreadable settings file, a command log that will not load)
  // used to leave `ready` false for good: no banners, no toolbar, no message, just an
  // empty frame. The work is still attempted in order; the `finally` is what guarantees
  // the user gets a window they can act in, even a degraded one.
  try
  {
    await settingsStore.load();
    // Read after loading, not at setup: the composable was constructed with the default
    // while the settings file was still being read.
    panelPane.size.value = settingsStore.settings.leftPanelWidth;

    settingsStore.applyTheme(resolveTheme(settingsStore.settings.theme));

    await log.load();

    unsubscribers.push(
      api.on('event:theme', (theme) => settingsStore.applyTheme(theme)),
      // A setting changed, in Settings or this window: adopting it here makes a
      // preference take effect at once, since every reader is reactive.
      api.on('event:settings', (next) => settingsStore.apply(next)),
      api.on('event:gitCommand', (record) => log.upsert(record)),
      api.on('event:logBatch', (batch) => revisions.onBatch(batch)),
      api.on('event:repoChanged', (change) =>
      {
        if (repoStore.repo?.path === change.path)
        {
          invalidateRepository(change.facets);
        }
      })
    );

    unsubscribers.push(api.on('event:windowFocus', onWindowFocus));

    // A worktree or a submodule opened from a dialog. The dialog cannot open it itself:
    // it has a store of its own and no grid: so the main process forwards the path here.
    unsubscribers.push(
      api.on('event:openRepo', (path) =>
      {
        void repoStore.open(path);
      })
    );

    // "Show in File Tree" from the commit dialog: it has no tree pane, so it asks over
    // `dialog:showInFileTree` and this is the other half.
    unsubscribers.push(
      api.on('event:showInFileTree', (path) =>
      {
        void settingsStore.patch({ filesPaneMode: 'tree' });
        diffStore.select(path);
      })
    );

    // The Advanced Filter dialog's session fields, the same relay shape: `load`'s `next`
    // parameter replaces the query and reloads in one call.
    unsubscribers.push(
      api.on('event:applyLogFilter', (filter) =>
      {
        const path = repoStore.repo?.path;
        if (path)
        {
          void revisions.load(path, filter);
        }
      })
    );

    // The Go to Commit dialog's answer: the grid whose selection moves is this window's;
    // `reveal` says which setting is hiding the commit when it's not found.
    unsubscribers.push(api.on('event:goToRevision', (sha) => reveal(sha)));

    // The grid follows whatever repository is open and reloads when any View-menu
    // setting `effectiveOptions` reads changes, so a setting takes effect without a
    // reopen. `branchFilter` is watched unconditionally even though it only matters in
    // `'filtered'` scope: skipping it would mean editing it while already Filtered did nothing.
    //
    // **An array of getters, not one getter returning an array**: Vue compares a
    // non-deep getter's result with `Object.is`, and a fresh array literal never matches
    // the last one, so a single-getter form fired on every dependency re-evaluation,
    // including each `repo.refresh()`. That re-streamed the log three times per tick and made the window flash on checkout.
    watch(
      [
        () => repoStore.repo?.path,
        () => settingsStore.settings.commitLoadLimit,
        () => settingsStore.settings.branchScope,
        () => settingsStore.settings.branchFilter,
        () => settingsStore.settings.logShowRemoteBranches,
        () => settingsStore.settings.logShowTags,
        () => settingsStore.settings.logShowStashes,
        () => settingsStore.settings.logShowReflog
      ],
      ([path], previous) =>
      {
      // The back/forward trail and selection don't carry to another repository: a pick
      // is a SHA the new repo has never heard of. `retain` drops them once the log
      // streams; this reaches the same end state before anything reads them.
        if (previous && path !== previous[0])
        {
          navigation.reset();
          selection.clear();
        }
        if (path)
        {
        // Reveal HEAD, so the window opens on a selected commit rather than on three
        // empty states ("Select a commit to see its details", the file list's, and the
        // diff's) and a File/History/Branch menu that is mostly greyed because nothing is
        // selected. `revealHead` is a request, not a demand: a scope or filter that hides
        // HEAD leaves the selection where it was.
          void revisions.load(path, undefined, { revealHead: repoStore.repo?.head ?? undefined });
          // Only on a repository change: the limit and scope are the grid's, and
          // reloading the panel for them would be five git calls it doesn't read.
          if (!previous || path !== previous[0])
          {
            void objects.load(path);
          }
        }
        else
        {
          revisions.reset();
          objects.reset();
          fileTreeStore.reset();
        }
      }
    );

    // Every commit the selection lands on is a place to come back to, recorded in one
    // watcher rather than at each call site. `visit` ignores a repeat, so back/forward don't record their own destinations.
    watch(() => selection.primary, (sha) => navigation.visit(sha));

    // Which branches are already contained in the selected commit: the left panel marks
    // them. Follows the selection rather than the repository, so it lives here beside the
    // other selection watcher rather than inside the panel's own load.
    watch(
      () => selection.primary,
      (sha) =>
      {
        if (sha === null || isArtificialSha(sha))
        {
          objects.loadMerged(null);
        }
        else
        {
          objects.loadMerged(sha);
        }
      },
      { immediate: true }
    );

    // "Open Submodule in New Window" says so in its own URL, since the choice must be
    // made before mount. Otherwise the last repo used; `repoStore.open` fails gracefully onto `WelcomeScreen.vue` when the path is gone.
    const startRepo = new URLSearchParams(window.location.search).get('repo');
    const [lastRepo] = settingsStore.settings.recentRepos;
    const opening = startRepo ?? lastRepo;
    if (opening)
    {
      await repoStore.open(opening);
    }

  }
  catch (err)
  {
    ui.toast(toMessage(err), 'error');
  }
  finally
  {
    ready.value = true;
  }
});

onUnmounted(() =>
{
  for (const off of unsubscribers)
  {
    off();
  }
});
</script>

<template>
  <div class="app">
    <!--
      The strip the macOS window buttons are drawn into.

      `titleBarStyle: 'hiddenInset'` gives the window no title bar of its own, so whatever
      renders first sits under the close/minimise/zoom buttons: the health banner, the
      operation banner, or the toolbar's leftmost control. This reserves that space once,
      for all of them, and is the window's only drag handle: without an `app-region` the
      window cannot be moved by its top edge at all.
    -->
    <div class="titlebar" />
    <HealthBanner v-if="ready" :context="context" />
    <OperationBanner v-if="ready" />
    <!-- Only with a repository open: every button on it acts on one, and a row of
         permanently greyed glyphs above the welcome screen says nothing. -->
    <Toolbar v-if="repoStore.isOpen" />

    <main class="content">
      <WelcomeScreen v-if="!repoStore.isOpen" />
      <!-- `.content` is a row: the panel, its divider, then the grid and details
           stacked in a column beside them. -->
      <template v-else>
        <template v-if="settingsStore.settings.showLeftPanel">
          <div class="panel-wrap" :style="{ width: `${panelPane.size.value}px` }">
            <LeftPanel />
          </div>
          <PaneSplitter :pane="panelPane" />
        </template>
        <LeftPanelRail v-else />

        <div class="workspace">
          <!-- The grid and the commit info are one band: the info says what the row you
               just clicked *is*, so it is as tall as the grid and stops where the grid
               does. Which side it takes is a setting. -->
          <div class="grid-band">
            <template v-if="settingsStore.settings.showCommitDetails && infoSide === INFO_SIDE_LEFT">
              <div class="info-wrap" :style="{ width: `${commitInfoPane.size.value}px` }">
                <CommitDetails />
              </div>
              <PaneSplitter :pane="commitInfoPane" />
            </template>

            <RevisionGrid />

            <template v-if="settingsStore.settings.showCommitDetails && infoSide === INFO_SIDE_RIGHT">
              <PaneSplitter :pane="commitInfoPane" />
              <div class="info-wrap" :style="{ width: `${commitInfoPane.size.value}px` }">
                <CommitDetails />
              </div>
            </template>
          </div>

          <!-- Its own setting: the pane beside the grid says what the commit is, this
               band says what it changed, and hiding one is not a wish to lose the other. -->
          <template v-if="settingsStore.settings.showFilePane">
            <PaneSplitter :pane="detailsPane" />
            <!-- Below the band, across its whole width: what the commit changed, and the
                 change itself. Side by side rather than behind tabs, so they answer
                 "what did this commit do" without a click. -->
            <div class="details-wrap" :style="{ height: `${detailsPane.size.value}px` }">
              <div class="files-wrap" :style="{ width: `${fileListPane.size.value}px` }">
                <ChangedFiles />
              </div>
              <PaneSplitter :pane="fileListPane" />
              <!-- The second column answers one of two questions about the first's
                   selection: what changed, or what's here. Its own setting, not the
                   list's: a tree row's diff is worth seeing, a changed file worth reading whole. -->
              <BlobViewer v-if="settingsStore.settings.filePaneView === FILE_PANE_VIEW_FILE" />
              <DiffViewer v-else />
            </div>
          </template>
        </div>
      </template>
    </main>

    <PaneSplitter v-if="log.visible" :pane="logPane" />
    <div v-if="log.visible" class="log-wrap" :style="{ height: `${logPane.size.value}px` }">
      <CommandLogPanel />
    </div>

    <StatusBar />

    <CommandPalette :context="context" />

    <!-- Every operation dialog is its own window (`main/dialogs.ts`): `ui.openDialog`
         is a message to main. What stays here is the confirm and the toasts. -->
    <ConfirmDialog v-if="ui.confirmRequest" />

    <ToastStack />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/*
 * 28px is the height of the macOS traffic lights plus their inset; the buttons sit at the
 * left, so the strip is empty and exists to be dragged. Every control below it then
 * starts from a clean edge and none of them needs to know the window is frameless.
 */
.titlebar {
  flex: none;
  height: 28px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
  -webkit-app-region: drag;
}

.content {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.placeholder {
  margin: auto;
  max-width: 460px;
  text-align: center;
  padding: var(--space-4);
}

.placeholder p {
  margin: 0 0 var(--space-2);
}

.muted {
  color: var(--fg-muted);
  font-size: var(--text-sm);
  line-height: 1.6;
}

kbd {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
}

.panel-wrap {
  flex: none;
  min-width: 0;
}

.workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.log-wrap,
.details-wrap {
  flex: none;
  min-height: 0;
}

.details-wrap {
  display: flex;
  min-width: 0;
  border-top: 1px solid var(--border);
}

/* The grid and the commit info, side by side and the same height. */
.grid-band {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.info-wrap,
.files-wrap {
  flex: none;
  min-width: 0;
  overflow: hidden;
}

</style>
