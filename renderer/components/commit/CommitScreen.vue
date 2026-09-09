<script setup lang="ts">
/**
 * The commit screen: the `commit.open` dialog window (`shared/dialogs.ts`).
 * Committing is the one thing here you *write* rather than confirm: read a diff, pick
 * parts of it, compose a message.
 *
 *   ┌──────────────┬────────────────────┐
 *   │ Unstaged     │  diff of whatever  │
 *   ├──────────────┤  is selected, with │
 *   │ Staged       │  hunk/line staging │
 *   │              ├────────────────────┤
 *   │              │  message + commit  │
 *   └──────────────┴────────────────────┘
 *
 * Three splitters, all persisted: the right proportions depend on the change, a
 * one-file commit wants the diff, a forty-file one wants the lists.
 *
 * **It is a `DialogFrame` like every other dialog**, with two flags: `flush` drops the
 * padding so panes reach the window's edges; `fixedHeight` tells `fit.ts` the height
 * isn't its to decide; `fullWindow` opens it at the repository window's size.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useCommandHotkeys } from '@renderer/composables/useCommandHotkeys.js';
import { commitOptionsMenu, commitResetMenu } from '@renderer/menus/staging.js';
import { resolveMenu, type MenuNode, type ResolvedItem } from '@renderer/menus/resolve.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import StagingList from './StagingList.vue';
import StagingDiff from './StagingDiff.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import PaneSplitter from '@renderer/components/ui/PaneSplitter.vue';
import MessageEditor from '@renderer/components/commit/MessageEditor.vue';
import { usePaneSizing } from './usePaneSizing.js';
import { useScreenKeyboard } from './useScreenKeyboard.js';
import { registerCommands } from '@renderer/commands/index.js';
import { READS } from '@shared/invalidation.js';

const emit = defineEmits<{ close: [] }>();

// The registry is built once per *window* (`App.vue`); `DialogHost` doesn't do it for
// every dialog (see `registerCommands`'s doc comment). Every menu row and button here
// runs through it, so this calls the same idempotent registration `StashDialog.vue` does.
registerCommands();


const repo = useRepoStore();
const staging = useStagingStore();
const ui = useUiStore();

const messageBox = ref<InstanceType<typeof MessageEditor> | null>(null);
const screen = ref<HTMLElement | null>(null);
const listsEl = ref<HTMLElement | null>(null);
const unstagedEl = ref<HTMLElement | null>(null);
const stagedEl = ref<HTMLElement | null>(null);

/** The three splitters, and the lists' divider fitting itself to their contents. */
const { lists, stagedPane, messagePane } = usePaneSizing({ listsEl, unstagedEl, stagedEl });

const heading = computed(() =>
{
  const branch = repo.repo?.branch;
  if (branch)
  {
    return `Commit to ${branch}`;
  }
  else
  {
    return 'Commit';
  }
});

const commandContext = useCommandContext();
const menu = ref<{ items: ResolvedItem[]; x: number; y: number } | null>(null);

function openMenu(nodes: MenuNode[], event: MouseEvent): void
{
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const items = resolveMenu(nodes, commandContext.value);
  // Above the button rather than below: both buttons sit on the bottom row of the
  // window, where a menu opening downwards would be off the screen.
  if (items.length)
  {
    menu.value = { items, x: box.left, y: Math.max(8, box.top - 8) };
  }
}

/**
 * Run what a menu row named, with the operand it carries. `options` isn't optional in
 * practice: the Options menu's pickers are rows that all run one command, differing
 * only in what they hand it (a message, an author, a prefix).
 */
function onMenuCommand(id: string, options?: unknown): void
{
  menu.value = null;
  void runCommand(id, commandContext.value, options);
}

/** The message box's caret, for the status bar: the only place on screen that says where in the message you are. */
const caret = ref({ line: 1, column: 1 });

const conflictCount = computed(
  () => repo.status?.files.filter((file) => file.worktree === 'conflicted').length ?? 0
);

function openConflicts(): void
{
  ui.openDialog('conflicts.resolve');
}

/**
 * Commit, and close the window when it worked. Every other dialog closes on success
 * via `useDialog`; this screen runs its own commit instead, so it does the same thing
 * explicitly: `commit()` reports whether it worked, and a failure leaves the window up with git's error on it.
 */
async function commitAndClose(options: { push?: boolean } = {}): Promise<void>
{
  if (await staging.commit(options))
  {
    emit('close');
  }
}

/** Cmd/Ctrl+Enter to commit, Escape to close, Cmd/Ctrl+1-4 to jump to a pane. */
useScreenKeyboard({
  screen,
  messageBox,
  menuOpen: () => menu.value !== null,
  closeMenu: () => (menu.value = null),
  onClose: () => emit('close')
});

/**
 * The registry's accelerators, in this window too. `useCommandHotkeys`, not
 * `useCommands`: the native menu bar's ids go to the window that owns the menu, and a
 * second window answering them would run every command twice. Installed *after*
 * `useScreenKeyboard`, so its handler runs first and this one stands down on an event already handled.
 */
useCommandHotkeys({ context: commandContext });

/** Amending starts from the message being amended, or it would silently discard it. */
watch(
  () => staging.amend,
  async (on) =>
  {
    if (!on || staging.message.trim() !== '' || !repo.repo)
    {
      return;
    }
    try
    {
      const text = await api['git:run'](repo.repo.path, ['log', '-1', '--format=%B'], READS);
      staging.message = text.trimEnd();
    }
    catch
    {
      // A repository with no commits has nothing to amend; the checkbox is its own
      // error message when git rejects the commit.
    }
  }
);

/**
 * The Options menu's three data-driven submenus, as the screen last read them. Built
 * from a store read, not fetched when the menu opens: `resolveMenu` is synchronous, and a
 * menu waiting on `git log` would open empty and change shape under the pointer.
 */
const commitOptions = computed(() =>
  commitOptionsMenu({
    recentMessages: staging.recentMessages,
    recentAuthors: staging.recentAuthors.map((entry) => entry.line)
  })
);

/**
 * The message and author pickers' contents. Watched on the repository, not read once
 * on mount: this window starts with no repository, adopting one from its payload a
 * moment later. Not on every refresh either: it's the history behind HEAD, unmoved until the commit closes the screen.
 */
watch(() => repo.repo?.path, () => void staging.loadHistory(), { immediate: true });

onMounted(() =>
{
  void staging.refresh();
  // This window's own commit-screen flag: see the doc comment on `commitScreenOpen` in
  // `stores/ui.ts` for why it is set here rather than by whoever opened the window.
  ui.markCommitScreen();
});

// The `.git` watcher doesn't know about this screen, so the lists follow the repo
// store's own reloads.
//
// Keyed on what the status *says*, not the object: `repo.refresh()` replaces `status`
// with a fresh object every time, so watching the object itself would re-read both
// lists on every refresh, including no-op ones. Separated by control characters,
// written as escapes: a raw NUL makes the file read as binary and grep skip it.
const statusKey = computed(() =>
  (repo.status?.files ?? [])
    .map((file) => `${file.path}\x00${file.index}\x00${file.worktree}`)
    .join('\x01')
);
watch(statusKey, () => void staging.refresh());

/**
 * Coming back to this window re-reads the working tree: the watcher watches `.git`, so
 * a file an editor or build wrote is invisible to it, and this screen is left and returned to more than any other.
 */
onMounted(() =>
{
  const stop = api.on('event:windowFocus', () =>
  {
    // `repo.refresh` re-reads the status, which the `watch` above turns into a list
    // reload; `staging.refresh` covers the case where the status is unchanged.
    void repo.refresh();
    void staging.refresh();
  });
  onBeforeUnmount(stop);
});
</script>

<template>
  <DialogFrame :title="heading" fixed-height flush @close="emit('close')">
    <!-- A merge cannot be committed until its conflicts are resolved, and the screen that
         would otherwise just refuse is the right place to say so. -->
    <template #titleActions>
      <button v-if="conflictCount > 0" class="conflicts" @click="openConflicts">
        {{ conflictCount }} unresolved
        {{ conflictCount === 1 ? 'conflict' : 'conflicts' }}, resolve
      </button>
      <span v-if="staging.error" class="error">{{ staging.error }}</span>
    </template>

    <div ref="screen" class="commit-screen" @focusin="ui.focusPane('commitScreen')">

    <div class="body">
      <div ref="listsEl" class="lists" :style="{ width: `${lists.size.value}px` }">
        <div ref="unstagedEl" class="unstaged">
          <StagingList side="unstaged" title="Unstaged" :files="staging.unstagedFiles" />
        </div>
        <PaneSplitter :pane="stagedPane" />
        <div ref="stagedEl" class="staged" :style="{ height: `${stagedPane.size.value}px` }">
          <StagingList side="staged" title="Staged" :files="staging.stagedFiles" />
        </div>
      </div>

      <PaneSplitter :pane="lists" />

      <div class="right">
        <div class="diff">
          <StagingDiff />
        </div>

        <PaneSplitter :pane="messagePane" />

        <div class="compose" :style="{ height: `${messagePane.size.value}px` }">
          <MessageEditor
            ref="messageBox"
            v-model="staging.message"
            class="message"
            placeholder="Commit message"
            @caret="caret = $event"
            @submit="commitAndClose()"
            @cancel="emit('close')"
          />

          <div class="controls">
            <label class="check">
              <input v-model="staging.amend" type="checkbox" />
              <span>Amend last commit</span>
            </label>

            <!-- Everything that throws work away is one deliberate click further in
                 than the button pressed forty times a day. -->
            <button @click="openMenu(commitResetMenu, $event)">Undo ▴</button>
            <button @click="openMenu(commitOptions, $event)">Options ▴</button>

            <span class="spacer" />
            <button
              :disabled="!staging.canCommit || staging.committing"
              @click="commitAndClose({ push: true })"
            >
              Commit and Push
            </button>
            <button
              class="primary"
              :disabled="!staging.canCommit || staging.committing"
              @click="commitAndClose()"
            >
              {{ staging.committing ? 'Committing…' : 'Commit' }}
            </button>
          </div>

          <CommandPreview
            :argv="staging.commitArgv"
            placeholder="Stage something and write a message"
          />
        </div>
      </div>
    </div>

    <!-- The status bar: where you are, what's staged, and the caret, the one thing about the message nothing else on screen can tell you. -->
    <footer class="status">
      <!-- The branch as a token, the way the repository window's own status bar sets it:
           a name in the prose face is a word. "detached" is a state, so it stays prose. -->
      <code v-if="repo.repo?.branch">{{ repo.repo.branch }}</code>
      <span v-else>detached</span>
      <span class="sep">·</span>
      <span>{{ staging.stagedFiles.length }} staged</span>
      <span class="sep">·</span>
      <span>{{ staging.unstagedFiles.length }} unstaged</span>
      <span class="spacer" />
      <span>Ln {{ caret.line }}, Col {{ caret.column }}</span>
    </footer>

      <ContextMenu
        v-if="menu"
        :items="menu.items"
        :x="menu.x"
        :y="menu.y"
        @run="onMenuCommand"
        @close="menu = null"
      />
    </div>
  </DialogFrame>
</template>

<style scoped>
/* No longer an overlay over `.content`: the whole of its own window now, filling it via
   `height: 100%` down the ancestor chain, not a position taken out of flow. */
.commit-screen {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* Room for the traffic lights. */
.error {
  color: var(--danger);
  font-size: var(--text-sm);
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.lists {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 0 0 auto;
}

.unstaged {
  flex: 1;
  min-height: 0;
}

.staged {
  flex: 0 0 auto;
  min-height: 0;
}

.right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.diff {
  flex: 1;
  min-height: 0;
}

.compose {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  min-height: 0;
}

/* The editor draws its own frame and its own text; the pane only says how much room. */
.message {
  flex: 1;
  min-height: 0;
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 0 0 auto;
}

/* One line, whatever the message: everywhere else the preview wraps since argv is
 * short, but this one carries `-m <the commit message>`, unbounded. Left to wrap, a
 * long message shrank the message box, the only flexible thing here, to fit it. */
.compose :deep(.preview) {
  flex: 0 0 auto;
}

.compose :deep(.preview .cmd) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: normal;
  min-width: 0;
}

.check {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.conflicts {
  background: var(--danger);
  color: var(--fg-on-accent);
  border-color: var(--danger);
  font-weight: 600;
  /* It sits inside the drag region above; without this it is undraggable and unclickable
     both, the same trap `DialogFrame`'s `.close` avoids. */
  -webkit-app-region: no-drag;
}

.status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-3);
  border-top: 1px solid var(--border);
  font-size: var(--text-sm);
  color: var(--fg-muted);
  flex: 0 0 auto;
}

.status .sep {
  color: var(--fg-subtle);
}

</style>
