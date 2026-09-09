<script setup lang="ts">
/**
 * Comparing two revisions, and the replacement for five overlapping menu rows. **Why a
 * window**: the pane below the grid answers "what did the row I clicked change?", and
 * redirecting it at an arbitrary `{ from, to }` would give it two jobs. **Almost
 * nothing here is new**: `ChangedFiles` beside `DiffViewer`, pointed at a range through
 * `diff.setRange`, the same pair `StashDialog` already uses. **No `useDialog().run()`**:
 * like `view.advancedFilter` this shapes a query, not a command, so there's no argv,
 * preview, or primary button. Closing it is the whole of finishing with it.
 */

import { computed, ref, watch } from 'vue';
import { registerCommands } from '@renderer/commands/index.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { sameEndpoint } from '@shared/diff.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import RepoFilePanes from '@renderer/components/dialogs/parts/RepoFilePanes.vue';
import RevisionSlot from '@renderer/components/dialogs/parts/RevisionSlot.vue';
import { namedRevision, type SlotRevision } from '@renderer/components/dialogs/parts/slotRevision.js';

const props = defineProps<{
  /** The older end, as a revision a caller named. */
  base?: string;
  /** The newer end. */
  to?: string;
}>();

const emit = defineEmits<{ close: [] }>();

// A dialog window otherwise starts with none of the command registry: `DialogHost`
// never calls `useCommands()`, but `ChangedFiles` and the two viewers resolve their own
// menus through it regardless of window. Without this the file list's switch draws as
// unknown ids. Idempotent per window, same as `StashDialog`.
registerCommands();

const diff = useDiffStore();

/** Both ends, seeded from the payload. The default is HEAD against the working tree: the useful thing to show someone who asked to compare without saying what. */
function seed(rev: string | undefined, fallback: SlotRevision): SlotRevision
{
  if (rev)
  {
    return namedRevision(rev);
  }
  else
  {
    return fallback;
  }
}

const base = ref<SlotRevision>(seed(props.base, namedRevision('HEAD')));
const to = ref<SlotRevision>(
  seed(props.to, { endpoint: { kind: 'workingTree' }, name: null })
);

/**
 * One revision on both ends is not a diff, and `buildDiffArgs` refuses it: without this
 * the pickers can put the window in a state whose only feedback is an exception thrown in
 * main. `null` instead, and the line under the pickers says why the panes are empty.
 */
const sameEnds = computed(() => sameEndpoint(base.value.endpoint, to.value.endpoint));

/** Point this window's file list and diff at the two slots. `setRange`, not a pin: there's no grid here and so no selection to override. */
watch(
  [base, to],
  () =>
  {
    if (sameEnds.value)
    {
      diff.setRange(null);
    }
    else
    {
      diff.setRange({ from: base.value.endpoint, to: to.value.endpoint });
    }
  },
  { immediate: true, deep: true }
);

/** Swap the ends. One assignment, since a slot holds its name *and* endpoint as one value: swapping them separately would leave a card's name pointing at the wrong endpoint. */
function swap(): void
{
  [base.value, to.value] = [to.value, base.value];
}

</script>

<template>
  <DialogFrame title="Compare" fixed-height @close="emit('close')">
    <div class="compare">
      <div class="ends">
        <RevisionSlot v-model="base" label="base" />
        <span class="arrow" aria-hidden="true">→</span>
        <RevisionSlot v-model="to" label="compare" />
        <button class="swap" type="button" title="Swap the two ends" @click="swap">⇄</button>
      </div>

      <p v-if="sameEnds" class="hint">Both ends name the same revision.</p>

      <RepoFilePanes />
    </div>
  </DialogFrame>
</template>

<style scoped>
.compare {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
}

/* Baseline-aligned so the two cards line up with the arrow between them, not with the labels above them. */
.ends {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
}

.arrow {
  padding-bottom: var(--space-1);
  color: var(--fg-subtle);
}

.swap {
  flex: none;
  margin-bottom: 2px;
  padding: 2px var(--space-2);
  color: var(--fg-muted);
}

</style>
