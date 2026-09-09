<script setup lang="ts">
/**
 * Persistent banner shown when git is mid-operation (merge, rebase, etc.).
 *
 * Stays visible until the operation is complete or aborted, so the app is
 * never silently mid-operation. Conflict count drives the conflict-resolve
 * button; zero conflicts surfaces Continue / Skip / Abort directly.
 */

import { computed } from 'vue';
import { toMessage } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { HISTORY_MOVE } from '@shared/invalidation.js';
import {
  OPERATION_AM as OP_AM,
  OPERATION_BISECT as OP_BISECT,
  OPERATION_CHERRY_PICK as OP_CHERRY_PICK,
  OPERATION_MERGE as OP_MERGE,
  OPERATION_REBASE as OP_REBASE,
  OPERATION_REVERT as OP_REVERT
} from '@shared/types.js';

// Git command flags for operation control
const FLAG_CONTINUE = '--continue';
const FLAG_SKIP = '--skip';
const FLAG_ABORT = '--abort';
const BISECT_RESET = 'reset';

const repo = useRepoStore();
const ui = useUiStore();

const state = computed(() => repo.state);

const operationLabel: Record<string, string> = {
  [OP_MERGE]: 'Merge',
  [OP_REBASE]: 'Rebase',
  [OP_CHERRY_PICK]: 'Cherry-pick',
  [OP_REVERT]: 'Revert',
  [OP_AM]: 'Apply patch',
  [OP_BISECT]: 'Bisect'
};

const label = computed(() => operationLabel[state.value.operation] ?? state.value.operation);

const continueArgs = computed((): string[] | null =>
{
  switch (state.value.operation)
  {
    case OP_REBASE: return [OP_REBASE, FLAG_CONTINUE];
    case OP_CHERRY_PICK: return [OP_CHERRY_PICK, FLAG_CONTINUE];
    case OP_REVERT: return [OP_REVERT, FLAG_CONTINUE];
    case OP_AM: return [OP_AM, FLAG_CONTINUE];
    default: return null;
  }
});

const skipArgs = computed((): string[] | null =>
{
  switch (state.value.operation)
  {
    case OP_REBASE: return [OP_REBASE, FLAG_SKIP];
    case OP_AM: return [OP_AM, FLAG_SKIP];
    default: return null;
  }
});

const abortArgs = computed((): string[] | null =>
{
  switch (state.value.operation)
  {
    case OP_MERGE: return [OP_MERGE, FLAG_ABORT];
    case OP_REBASE: return [OP_REBASE, FLAG_ABORT];
    case OP_CHERRY_PICK: return [OP_CHERRY_PICK, FLAG_ABORT];
    case OP_REVERT: return [OP_REVERT, FLAG_ABORT];
    case OP_AM: return [OP_AM, FLAG_ABORT];
    // No menu row starts bisect, but git can be mid-bisect from terminal. Offer abort.
    case OP_BISECT: return [OP_BISECT, BISECT_RESET];
    default: return null;
  }
});

async function run(args: string[]): Promise<void>
{
  if (!repo.repo)
  {
    return;
  }
  try
  {
    // Continue, skip or abort of a merge/rebase/cherry-pick/revert/bisect: every one
    // of them can move HEAD and rewrite both trees.
    // Named after what it is: these are continue, skip and abort, and a label that
    // says "Continuing" over an abort's output is a lie in the one place you read it.
    await runConsoleSteps(
      repo.repo.path,
      [{ label: `git ${args[0]} ${args[1] ?? ''}`.trim(), argv: args }],
      HISTORY_MOVE
    );
    await repo.refresh();
  }
  catch (e)
  {
    ui.toast(toMessage(e), 'error');
  }
}
</script>

<template>
  <div v-if="repo.isMidOperation" class="banner" :class="{ conflicts: state.conflictCount > 0 }">
    <span class="msg">
      <strong>{{ label }} in progress</strong>
      <template v-if="state.conflictCount > 0">
       · {{ state.conflictCount }} {{ state.conflictCount === 1 ? 'conflict' : 'conflicts' }}
      </template>
    </span>

    <div class="ops">
      <button
        v-if="state.conflictCount > 0"
        class="primary small"
        @click="ui.openDialog('conflicts.resolve')"
      >
        Resolve Conflicts…
      </button>
      <template v-else>
        <button
          v-if="continueArgs"
          class="primary small"
          @click="run(continueArgs!)"
        >
          Continue
        </button>
        <button
          v-if="skipArgs"
          class="small"
          @click="run(skipArgs!)"
        >
          Skip
        </button>
      </template>
      <button
        v-if="abortArgs"
        class="danger small"
        @click="run(abortArgs!)"
      >
        Abort
      </button>
    </div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4);
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
  flex: none;
}
.banner.conflicts {
  background: color-mix(in srgb, var(--warning) 12%, var(--bg));
  border-color: color-mix(in srgb, var(--warning) 40%, var(--border));
}
.msg { flex: 1; }
.ops { display: flex; gap: var(--space-1); flex: none; }
button.small { padding: 2px var(--space-2); font-size: var(--text-xs); }
</style>
