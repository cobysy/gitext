<script setup lang="ts">
/**
 * Deleting branches on a remote: deleting a remote branch is a **push**, happens for
 * everybody, and has no local undo. A list, not one branch: *Delete Remote Branch…*
 * ticks one, *Delete Remote Branches…* ticks none, grouped by remote as one
 * `push --delete` each. Also offers the local tracking branch: deleting `origin/feature`
 * leaves local `feature` behind tracking nothing, which is where `[gone]` comes from.
 */

import { computed, onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildDeleteBranchArgs } from '@renderer/model/args/branch.js';
import { buildDeleteRemoteRefArgs } from '@renderer/model/args/tag.js';
import type { ArgvStep } from '@renderer/model/args/checkout.js';
import { splitRemoteBranch } from '@renderer/model/localBranchName.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormCheckList from '@renderer/components/ui/FormCheckList.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';
import { REF_KIND_BRANCH, REF_KIND_REMOTE } from '@shared/types.js';

const props = defineProps<{
  /** A remote branch, as `origin/feature`: ticked when the dialog opens. */
  gitRef?: string;
  /** A remote whose branches are the ones to choose from. Absent means all of them. */
  remoteName?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const { busy, error, runSteps } = useDialog();

const remoteNames = computed(() => objects.remotes.map((entry) => entry.name));

/** Which remote's branches to offer: the payload rule, whichever surface opened this said what it was about. A remote branch narrows it to its own remote. */
const scope = computed(() =>
{
  let fromRef: string | undefined;
  if (props.gitRef)
  {
    fromRef = splitRemoteBranch(props.gitRef, remoteNames.value)?.remote;
  }
  else
  {
    fromRef = undefined;
  }
  return props.remoteName ?? fromRef ?? null;
});

const candidates = computed(() =>
  objects.refs.filter(
    (entry) => entry.kind === REF_KIND_REMOTE && (scope.value === null || entry.remote === scope.value)
  )
);

/** A set rather than a record of booleans: `chosen[name]` would be `boolean | undefined` under `noUncheckedIndexedAccess`, a checkbox with three states. */
let initialChosen: string[];
if (props.gitRef)
{
  initialChosen = [props.gitRef];
}
else
{
  initialChosen = [];
}
const chosen = ref<ReadonlySet<string>>(new Set(initialChosen));

function choose(name: string, on: boolean): void
{
  const next = new Set(chosen.value);
  if (on)
  {
    next.add(name);
  }
  else
  {
    next.delete(name);
  }
  chosen.value = next;
}

const selected = computed(() => candidates.value.filter((entry) => chosen.value.has(entry.name)));

const deleteLocal = ref(false);

/** The local branches that track what is selected, by upstream, not name: a branch called `work` tracking `origin/feature` is the one left stranded. */
const tracking = computed(() =>
  objects.refs.filter(
    (entry) =>
      entry.kind === REF_KIND_BRANCH && entry.upstream !== null && chosen.value.has(entry.upstream)
  )
);

/** Which of the selected branches have commits on nothing else. Said in the form, not a second window in front of delete, to be read before the button. */
const mergedIntoHead = ref<ReadonlySet<string>>(new Set());

const unmerged = computed(() =>
  selected.value.filter((entry) => !mergedIntoHead.value.has(entry.fullName))
);

/** One `push --delete` per remote. */
const steps = computed<ArgvStep[]>(() =>
{
  const byRemote = new Map<string, string[]>();
  for (const entry of selected.value)
  {
    const parts = splitRemoteBranch(entry.name, remoteNames.value);
    if (!parts)
    {
      continue;
    }
    byRemote.set(parts.remote, [...(byRemote.get(parts.remote) ?? []), parts.branch]);
  }

  const steps: ArgvStep[] = [...byRemote].map(([remote, branches]) =>
  {
    let what: string;
    if (branches.length === 1)
    {
      what = branches[0]!;
    }
    else
    {
      what = `${branches.length} branches`;
    }
    return { label: `Deleting ${what} on ${remote}`, argv: buildDeleteRemoteRefArgs(remote, branches) };
  });

  if (deleteLocal.value && tracking.value.length)
  {
    let noun: string;
    if (tracking.value.length === 1)
    {
      noun = 'branch';
    }
    else
    {
      noun = 'branches';
    }
    steps.push({
      label: `Deleting the local ${noun}`,
      // Forced: the remote copy has just gone, so git's merged check has nothing left to compare against and would refuse a branch that's perfectly safe.
      argv: buildDeleteBranchArgs(
        tracking.value.map((entry) => entry.name),
        true
      )
    });
  }

  return steps;
});

const title = computed(() =>
{
  if (scope.value)
  {
    return `Delete Branches on ${scope.value}`;
  }
  else
  {
    return 'Delete Remote Branches';
  }
}
);

/** The sentence about commits left reachable from nothing, or none. Worked out here, not in the template: three cases of subject agreement. */
/**
 * Whether this looks like the remote's trunk.
 *
 * A name test, deliberately: `refs/remotes/<remote>/HEAD` is the authoritative answer but
 * it is not in the ref list this dialog reads, and it is often unset on a clone anyway.
 * The cost of a false positive is one extra sentence beside a branch; the cost of a false
 * negative is deleting everyone's `main` with no warning at all.
 */
function isDefaultBranch(entry: { name: string; fullName: string }): boolean
{
  return /(^|\/)(main|master|trunk|develop)$/.test(entry.name);
}

/** What to say beside a branch: that it is the trunk first, since that outranks the rest. */
function hintFor(entry: { name: string; fullName: string }): string | undefined
{
  if (isDefaultBranch(entry))
  {
    return 'Looks like the default branch. Deleting it on the remote affects everyone.';
  }
  if (!mergedIntoHead.value.has(entry.fullName))
  {
    return 'Not merged into `HEAD`.';
  }
  return undefined;
}

const unmergedNote = computed(() =>
{
  if (unmerged.value.length === 0)
  {
    return '';
  }
  if (selected.value.length === 1)
  {
    return 'It has commits on no other branch.';
  }
  if (unmerged.value.length === 1)
  {
    return 'One of them has commits on no other branch.';
  }
  return `${unmerged.value.length} of them have commits on no other branch.`;
});

onMounted(async () =>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  try
  {
    mergedIntoHead.value = new Set(await api['refs:merged'](path, 'HEAD'));
  }
  catch
  {
    // Nothing marked is the honest answer when the question failed; every branch then reads as unmerged, erring towards showing the warning rather than hiding it.
    mergedIntoHead.value = new Set();
  }
});
</script>

<template>
  <DialogFrame :title="title" @close="emit('close')">
    <div class="form">
      <p v-if="!candidates.length" class="placeholder">
        <template v-if="scope"><code>{{ scope }}</code> has no branches here.</template>
        <template v-else>There are no remote branches.</template>
      </p>

      <FormCheckList v-else>
        <FormCheck
          v-for="entry in candidates"
          :key="entry.fullName"
          :model-value="chosen.has(entry.name)"
          :label="`\`${entry.name}\``"
          :hint="hintFor(entry)"
          @update:model-value="(on: boolean) => choose(entry.name, on)"
        />
      </FormCheckList>

      <DangerNote v-if="selected.length">
        This is a push.
        {{
          selected.length === 1
            ? `${selected[0]?.name} is deleted`
            : `${selected.length} branches are deleted`
        }}
        for everybody, and there is no local undo.
        {{ unmergedNote }}
      </DangerNote>

      <FormCheck
        v-if="tracking.length"
        v-model="deleteLocal"
        :label="
          tracking.length === 1
            ? `Delete the local branch ${tracking[0]?.name} too`
            : `Delete the ${tracking.length} local branches that track them too`
        "
        hint="Otherwise it is left showing as [gone]."
      />
      <p v-else-if="selected.length" class="hint">
        Nothing local tracks what is selected.
      </p>

      <CommandPreview :steps="steps" placeholder="Pick at least one branch" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="danger" :disabled="busy || !selected.length" @click="runSteps(steps, REFS)">
        {{ busy ? 'Deleting…' : 'Delete on Remote' }}
      </button>
    </template>
  </DialogFrame>
</template>
