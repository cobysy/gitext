<script setup lang="ts">
/**
 * Delete local branches whose work has landed. Squash-merged branches need `-D` (no ancestry link).
 * Dialog shows why each branch is offered, lists kept-back branches, and shows all steps in preview.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { formatRelativeDate } from '@renderer/format.js';
import { useDialog, type Step } from '@renderer/composables/useDialog.js';
import { buildBranchDeleteSteps } from '@renderer/model/args/index.js';
import { REF_KIND_BRANCH, type BranchCleanupReport } from '@shared/types.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';

const props = defineProps<{ repoPath: string }>();
const emit = defineEmits<{ close: [] }>();
const { busy, error, runSteps } = useDialog();

// Branch cleanup reasons
const REASON_SQUASHED = 'squashed';
const REASON_CONTAINED = 'contained';

const FLAG_DELETE_FORCE = '-D';

const comparison = ref('');
const branches = ref<{ value: string; label: string }[]>([]);
const report = ref<BranchCleanupReport | null>(null);
const picked = ref(new Set<string>());
const scanning = ref(false);

const stale = computed(() => report.value?.stale ?? []);
const keptBack = computed(() => report.value?.keptBack ?? []);

/** Split by which flag each branch needs: the plan the preview and the run both read. */
const plan = computed(() => ({
  safe: stale.value.filter((b) => b.reason === REASON_CONTAINED && picked.value.has(b.name)).map((b) => b.name),
  forced: stale.value.filter((b) => b.reason === REASON_SQUASHED && picked.value.has(b.name)).map((b) => b.name)
}));

const steps = computed(() => buildBranchDeleteSteps(plan.value));
const pickedCount = computed(() => plan.value.safe.length + plan.value.forced.length);

/**
 * The same steps, each carrying the sentence its failure belongs to. `-d` refusing a
 * branch and `-D` refusing one are different problems, and a single "git branch failed"
 * would not say which of the two lines above produced it.
 */
const labelled = computed((): Step[] =>
  steps.value.map((argv) =>
  {
    let label: string;
    if (argv.includes(FLAG_DELETE_FORCE))
    {
      label = 'Force-deleting the squash-merged branches failed';
    }
    else
    {
      label = 'Deleting the merged branches failed';
    }
    return { label, argv };
  })
);

function toggle(name: string): void
{
  const next = new Set(picked.value);
  if (next.has(name))
  {
    next.delete(name);
  }
  else
  {
    next.add(name);
  }
  picked.value = next;
}

function selectAll(): void
{
  picked.value = new Set(stale.value.map((b) => b.name));
}

function selectNone(): void
{
  picked.value = new Set();
}

async function scan(): Promise<void>
{
  if (!comparison.value)
  {
    return;
  }
  scanning.value = true;
  error.value = '';
  // Never carry a tick across a rescan: the list it referred to is gone, and a name that
  // survives into a different comparison would be selected without having been looked at.
  picked.value = new Set();
  try
  {
    report.value = await api['branch:stale'](props.repoPath, comparison.value);
  }
  catch (e)
  {
    error.value = toMessage(e);
    report.value = null;
  }
  finally
  {
    scanning.value = false;
  }
}

async function run(): Promise<void>
{
  if (pickedCount.value === 0)
  {
    return;
  }
  if (await runSteps(labelled.value, REFS))
  {
    return;
  }
  // Something may have been deleted before the failure: show what is true now, without
  // losing the reason it stopped: `scan` clears the error line it does not own.
  const failure = error.value;
  await scan();
  error.value = failure;
}

onMounted(async () =>
{
  try
  {
    const refs = await api['refs:list'](props.repoPath);
    const locals = refs.filter((r) => r.kind === REF_KIND_BRANCH);
    branches.value = locals.map((r) => ({ value: r.name, label: r.name }));
    // Default to the branch work lands on, when it is one of the usual names; otherwise
    // whatever is checked out, which is at least a branch that exists.
    const preferred = ['main', 'master', 'develop'].find((n) => locals.some((r) => r.name === n));
    comparison.value = preferred ?? locals.find((r) => r.isCurrent)?.name ?? locals[0]?.name ?? '';
  }
  catch (e)
  {
    error.value = toMessage(e);
  }
  await scan();
});

watch(comparison, scan);
</script>

<template>
  <DialogFrame title="Clean Up Branches" @close="emit('close')">
    <div class="form">
      <FormSelect
        v-model="comparison"
        label="Merged into"
        :options="branches"
        hint="Only branches already merged into it."
      />

      <p v-if="scanning" class="placeholder">Checking every local branch…</p>

      <template v-else>
        <div v-if="stale.length" class="head">
          <span class="count">
            {{ pickedCount }} of {{ stale.length }} selected
          </span>
          <span class="spacer" />
          <button type="button" @click="selectAll">Select all</button>
          <button type="button" @click="selectNone">Select none</button>
        </div>

        <ul v-if="stale.length" class="list side offer">
          <li
            v-for="branch in stale"
            :key="branch.name"
            class="item"
            :class="{ picked: picked.has(branch.name) }"
          >
            <label class="pick">
              <input
                type="checkbox"
                :checked="picked.has(branch.name)"
                @change="toggle(branch.name)"
              />
              <span class="name truncate">{{ branch.name }}</span>
            </label>
            <span class="tags">
              <span class="tag" :class="branch.reason">
                {{ branch.reason === REASON_SQUASHED ? 'squash-merged · needs -D' : 'merged' }}
              </span>
              <span v-if="branch.upstreamGone" class="tag gone">upstream gone</span>
            </span>
            <span class="age">{{ formatRelativeDate(branch.date) }}</span>
          </li>
        </ul>

        <p v-else class="placeholder">
          Nothing to clean up: no local branch has landed on
          <code>{{ comparison }}</code> already.
        </p>

        <details v-if="keptBack.length" class="kept">
          <summary>{{ keptBack.length }} {{ keptBack.length === 1 ? 'branch' : 'branches' }} kept back</summary>
          <ul class="list side">
            <li v-for="entry in keptBack" :key="entry.name" class="item">
              <span class="name truncate">{{ entry.name }}</span>
              <span class="why">{{ entry.why }}</span>
            </li>
          </ul>
        </details>
      </template>

      <CommandPreview
        v-for="argv in steps"
        :key="argv.join(' ')"
        :argv="argv"
      />
      <p v-if="steps.length === 0" class="hint">Select a branch to see the command.</p>

      <p v-if="plan.forced.length" class="warn">
        {{ plan.forced.length }} {{ plan.forced.length === 1 ? 'branch' : 'branches' }} will
        be deleted with <code>-D</code>. git cannot verify a squash merge itself.
      </p>

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="danger" :disabled="pickedCount === 0 || busy" @click="run">
        {{ busy ? 'Deleting…' : `Delete ${pickedCount || ''} Branch${pickedCount === 1 ? '' : 'es'}`.replace(/\s+/g, ' ') }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped src="@renderer/styles/manageList.css"></style>
<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* One grid for the whole box, each row drawn on it with `subgrid`, rather than a row of
   flex children: what a branch is and how old it is read down the list as columns
   instead of starting wherever the name before them ended. */
.list.side {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content max-content;
  /* Between the columns only: the rows are separated by the box's own hairlines, and a
     row gap here would break them into cards again. */
  column-gap: var(--space-3);
  max-height: 260px;
}

/* A band across the box, like every other list in the app: the hairline above it comes
   from `manageList.css`, and the row itself owns nothing but its padding. */
.item {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  padding: var(--space-2);
}

/* Only in the list you act on: the kept-back rows are a statement, not a choice, and a
   row that lights up under the pointer says it can be clicked. */
.offer .item:hover {
  background: var(--bg-hover);
}

/* Ticked rows are the ones the button acts on, so they carry the same tint a selected
   row carries anywhere else. */
.offer .item.picked {
  background: var(--bg-selected);
}

/* The checkbox and the name are one target: the row is a choice, and a 12px box is a
   needlessly small thing to have to hit for something this destructive. */
.pick {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

.name {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

/* One cell, however many badges a branch earns: a second badge widens the column for
   every row rather than pushing the date out of line on its own. */
.tags {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tag {
  flex: none;
  font-size: var(--text-xs);
  padding: 1px var(--space-2);
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--fg-muted);
}

/* The rows that need `-D` are the ones worth a second look, so they carry the warning
   colour rather than the neutral one. */
.tag.squashed {
  border-color: var(--warning);
  color: var(--warning);
}

.tag.gone {
  border-color: var(--border-subtle);
}

/* Right-aligned in its column: the ages end at one edge, and the list has a straight
   right side rather than a ragged one. */
.age {
  text-align: right;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

/* The reason a branch was held back is prose, so it starts at the column's left edge
   where the ages end at its right. */
.why {
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

.kept summary {
  font-size: var(--text-sm);
  color: var(--fg-muted);
  cursor: pointer;
}

/* Two columns here, name and reason: its own grid, so its rows line up with each other
   rather than with the list of branches on offer above. */
.kept .list.side {
  margin-top: var(--space-2);
  grid-template-columns: minmax(0, 1fr) max-content;
}
</style>
