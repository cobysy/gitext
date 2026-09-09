<script setup lang="ts">
/**
 * Bottom status bar: repo identity, ahead/behind, and the command log toggle.
 *
 * The three statements about the repository are controls, not labels. They were the most
 * read line in the window and the only one with nothing to click: the branch you are on,
 * how far it is from its upstream, and how much is uncommitted, each of which is the
 * question whose answer is one command away.
 */

import { computed, ref } from 'vue';
import { shortSha } from '@renderer/format.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useCommandLogStore } from '@renderer/stores/commandLog.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useContextMenu } from '@renderer/composables/useContextMenu.js';
import { resolveMenu } from '@renderer/menus/resolve.js';
import { currentBranchMenu } from '@renderer/menus/currentBranch.js';
import ContextMenu from '@renderer/components/ui/ContextMenu.vue';
import {
  OPERATION_AM,
  REF_KIND_BRANCH,
  OPERATION_BISECT,
  OPERATION_CHERRY_PICK,
  OPERATION_MERGE,
  OPERATION_REBASE,
  OPERATION_REVERT
} from '@shared/types.js';

const repoStore = useRepoStore();
const objects = useRepoObjectsStore();
const log = useCommandLogStore();

const branchLabel = computed(() =>
{
  const repo = repoStore.repo;
  if (!repo)
  {
    return null;
  }
  if (repo.branch)
  {
    return repo.branch;
  }
  // Use short SHA for detached HEAD label. Unborn repos have neither, just "detached".
  if (repo.head)
  {
    return `detached at ${shortSha(repo.head)}`;
  }
  else
  {
    return 'detached';
  }
});

const ahead = computed(() => repoStore.status?.ahead ?? 0);
const behind = computed(() => repoStore.status?.behind ?? 0);

/** Operation label, or null if idle. */
const operationLabel = computed(() =>
{
  switch (repoStore.state.operation)
  {
    case OPERATION_MERGE:
      return 'Merging';
    case OPERATION_REBASE:
      return 'Rebasing';
    case OPERATION_CHERRY_PICK:
      return 'Cherry-picking';
    case OPERATION_REVERT:
      return 'Reverting';
    case OPERATION_BISECT:
      return 'Bisecting';
    case OPERATION_AM:
      return 'Applying patch';
    default:
      return null;
  }
});

// ── The controls ─────────────────────────────────────────────────────────────

const COMMAND_PUSH = 'remote.push';
const COMMAND_PULL = 'remote.pull';
const COMMAND_COMMIT = 'commit.open';

const commandContext = useCommandContext();
const { menu, openBelow, close: closeMenu } = useContextMenu();
/** Where the keyboard goes when the menu closes: the button it was opened from. */
const branchButton = ref<HTMLElement | null>(null);

/** The local branches: the list the menu leads with, same as the toolbar's button. */
const localBranches = computed(() =>
  objects.refs.filter((entry) => entry.kind === REF_KIND_BRANCH)
);

function openBranchMenu(): void
{
  if (branchButton.value)
  {
    // `openBelow` clamps to the viewport, so a bar at the bottom of the window opens upward.
    openBelow(
      branchButton.value,
      resolveMenu(currentBranchMenu(localBranches.value), commandContext.value)
    );
  }
}

/** `options` is the operand a row named: each branch row carries its own ref. */
async function run(id: string, options?: unknown): Promise<void>
{
  closeMenu();
  await runCommand(id, commandContext.value, options);
}
</script>

<template>
  <footer class="bar">
    <template v-if="repoStore.repo">
      <span class="repo" :title="repoStore.repo.path">{{ repoStore.repo.name }}</span>
      <span class="sep">·</span>
      <button
        ref="branchButton"
        class="cell branch"
        aria-haspopup="menu"
        title="What this branch can do"
        @click="openBranchMenu()"
      >
        {{ branchLabel }}
      </button>

      <span v-if="ahead || behind" class="tracking">
        <button v-if="ahead" class="cell" title="Commits to push" @click="run(COMMAND_PUSH)">
          ↑{{ ahead }}
        </button>
        <button v-if="behind" class="cell" title="Commits to pull" @click="run(COMMAND_PULL)">
          ↓{{ behind }}
        </button>
      </span>

      <button
        v-if="repoStore.changedFileCount"
        class="cell changes"
        title="Commit these changes"
        @click="run(COMMAND_COMMIT)"
      >
        {{ repoStore.changedFileCount }} changed
      </button>

      <span v-if="operationLabel" class="operation">
        {{ operationLabel }}
        <template v-if="repoStore.state.conflictCount">
         · {{ repoStore.state.conflictCount }} conflict{{
            repoStore.state.conflictCount === 1 ? '' : 's'
          }}
        </template>
      </span>
    </template>

    <span v-else class="muted">No repository open</span>

    <div class="spacer" />

    <button class="log" :class="{ active: log.visible }" @click="log.toggle()">
      <span v-if="log.failureCount" class="failures">{{ log.failureCount }}</span>
      Git log
    </button>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @run="run"
      @close="closeMenu()"
    />
  </footer>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  height: 26px;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--bg-subtle);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.repo {
  color: var(--fg);
  font-weight: 500;
}

.sep {
  color: var(--fg-subtle);
}

/*
 * A statement in the bar that is also a control. It has to read as the text it replaced
 * until the pointer is on it: a button drawn as a button, six of them across a 26px strip,
 * would turn the quietest line in the window into a toolbar.
 */
.cell {
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
  height: 18px;
  font-size: var(--text-xs);
  color: inherit;
}

.cell:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.branch {
  font-family: var(--font-mono);
}

.tracking {
  display: flex;
  gap: var(--space-1);
  font-family: var(--font-mono);
}

.operation {
  color: var(--warning);
  font-weight: 500;
}

.log {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  border: none;
  background: none;
  font-size: var(--text-xs);
  color: var(--fg-muted);
  padding: 0 var(--space-2);
  height: 100%;
  border-radius: 0;
}

.log:hover,
.log.active {
  background: var(--bg-hover);
  color: var(--fg);
}

.failures {
  background: var(--danger);
  color: var(--fg-on-accent);
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
}

.muted {
  color: var(--fg-subtle);
}
</style>
