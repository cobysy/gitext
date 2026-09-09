<script setup lang="ts">
/**
 * Pushing. Three behaviours are the reason it's worth rebuilding rather than trimming,
 * all about what happens *after* the button:
 *
 * 1. **A plain `--force` offers `--force-with-lease` instead.** They look
 *    interchangeable and aren't: with a lease, work pushed since your last fetch stops the push; without one it vanishes silently.
 * 2. **A branch with no upstream offers to set one.** Otherwise the next terminal
 *    `git push` fails with "no upstream configured".
 * 3. **A rejected push offers the three things that resolve it** (pull-rebase,
 *    pull-merge, force-with-lease), rather than printing git's "fetch first" and stopping.
 *
 * The tags tab replaces `PushTagDialog`: pushing a tag is a push, belonging where the
 * remote is already chosen.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import {
  buildPushAllArgs,
  buildPushArgs,
  buildPushTagArgs,
  FORCE_MODES,
  isRejectedPush,
  REJECTION_REMEDIES,
  rejectionRemedy,
  type ForceMode,
  type RejectionRemedy,
  type SubmodulePushMode
} from '@renderer/model/args/push.js';
import { buildPullArgs } from '@renderer/model/args/pull.js';
import { flagsIn, summaryOf } from '@renderer/model/args/summary.js';
import { defaultRemoteName } from '@renderer/model/remoteDefaults.js';
import { REF_KIND_BRANCH, type RemoteEntry } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormRow from '@renderer/components/ui/FormRow.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';

// Push dialog tab values
const TAB_BRANCH = 'branch';
const TAB_TAGS = 'tags';
const TAB_ALL = 'all';

// Force modes
const FORCE_NONE = 'none';
const FORCE_PLAIN = 'force';
const FORCE_LEASE = 'lease';

// Rejection remedies
const REMEDY_PULL_REBASE = 'pull-rebase';
const REMEDY_FORCE_LEASE = 'force-lease';

// Pull actions
const PULL_REBASE = 'rebase';
const PULL_MERGE = 'merge';

// Submodule modes
const SUBMODULE_NONE = 'none';
const SUBMODULE_CHECK = 'check';
const SUBMODULE_ON_DEMAND = 'on-demand';

// Ref kinds

// Flags shown in the folded-panel summary
const FLAG_PROGRESS = '--progress';
const FLAG_ALL = '--all';
const FLAG_TAGS = '--tags';


const props = defineProps<{
  /** The branch a surface named. */
  branch?: string;
  /** A tag to push: opens on the tags tab. */
  tagName?: string;
  /**
   * git's stderr from a push that already failed elsewhere, handed over rather than
   * closed over. Shown as the error; a "remote has moved" rejection opens the window on the answers to it instead of the form.
   */
  failure?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const ui = useUiStore();
const { busy, error, failureOutput, run, runSteps, close } = useDialog();

type Tab = typeof TAB_BRANCH | typeof TAB_TAGS | typeof TAB_ALL;

/** True when the branch tab is pushing under a different name than it was checked out as. */
function isRenamingBranch(tab: Tab, from: string, to: string): boolean
{
  return tab === TAB_BRANCH && !!to.trim() && to.trim() !== from.trim();
}

/** True when a branch push would leave `from` without a tracked upstream. */
function isPushingWithoutTrackedUpstream(
  tab: Tab,
  hasUpstream: boolean,
  setUpstream: boolean,
  from: string
): boolean
{
  return tab === TAB_BRANCH && !hasUpstream && !setUpstream && !!from;
}

let initialTab: Tab;
if (props.tagName)
{
  initialTab = TAB_TAGS;
}
else
{
  initialTab = TAB_BRANCH;
}
const tab = ref<Tab>(initialTab);

const remotes = ref<RemoteEntry[]>([]);
const remote = ref('');
const from = ref(props.branch ?? '');
const to = ref('');
const force = ref<ForceMode>(FORCE_NONE);
const setUpstream = ref(false);
const submodules = ref<SubmodulePushMode>(SUBMODULE_NONE);
const showOptions = ref(false);

const tagName = ref(props.tagName ?? '');
const allTags = ref(false);

/** Branches the remote already has, so "this would create it" can be said before it does. */
const remoteHeads = ref<string[]>([]);

const currentBranch = computed(() => repo.repo?.branch ?? null);

const localRef = computed(() =>
  objects.refs.find((entry) => entry.kind === REF_KIND_BRANCH && entry.name === from.value)
);
const hasUpstream = computed(() => Boolean(localRef.value?.upstream));

/** Where the chosen remote pushes, as a token: a URL is read character by character. */
const remoteUrlHint = computed(() =>
{
  const url = remotes.value.find((entry) => entry.name === remote.value)?.pushUrl;
  if (url)
  {
    return `\`${url}\``;
  }
  else
  {
    return undefined;
  }
});

/** True when the push would create the branch on the remote rather than update it. */
const wouldCreate = computed(
  () => from.value.length > 0 && remoteHeads.value.length > 0 && !remoteHeads.value.includes(to.value || from.value)
);

const SUBMODULE_OPTIONS: readonly RadioOption[] = [
  { value: SUBMODULE_NONE, label: 'Ignore submodules', hint: "git's default." },
  {
    value: SUBMODULE_CHECK,
    label: 'Refuse if a submodule commit is not pushed',
    hint: '`--recurse-submodules=check`'
  },
  {
    value: SUBMODULE_ON_DEMAND,
    label: 'Push the submodules too',
    hint: '`--recurse-submodules=on-demand`'
  }
];

/**
 * What the folded panel is carrying, said on the toggle itself: without it the fold
 * would hide `--force`, worse than listing every control flat. Only non-defaults.
 */
const optionsSummary = computed(() =>
{
  let renamedTo: string;
  if (isRenamingBranch(tab.value, from.value, to.value))
  {
    renamedTo = `to ${to.value.trim()}`;
  }
  else
  {
    renamedTo = '';
  }
  return summaryOf([
    renamedTo,
    // `--progress` is always there, and `--all`/`--tags` come from the visible radio row.
    flagsIn(argv.value, [FLAG_PROGRESS, FLAG_ALL, FLAG_TAGS])
  ]);
});

const forceOptions = computed<readonly RadioOption[]>(() =>
  FORCE_MODES.map((entry) => ({
    value: entry.mode,
    label: entry.label,
    hint: entry.detail
  }))
);

/**
 * The push this form describes, at whichever force level is asked for. A parameter,
 * not read from `force`: the rejection panel previews a push at `--force-with-lease`
 * while the form still says what it said.
 */
function pushArgvWith(level: ForceMode): string[]
{
  if (tab.value === TAB_TAGS)
  {
    return buildPushTagArgs({
      remote: remote.value,
      tag: tagName.value,
      all: allTags.value,
      force: level
    });
  }
  if (tab.value === TAB_ALL)
  {
    return buildPushAllArgs({
      remote: remote.value,
      force: level,
      setUpstream: setUpstream.value,
      submodules: submodules.value
    });
  }
  return buildPushArgs({
    remote: remote.value,
    from: from.value,
    to: to.value,
    force: level,
    setUpstream: setUpstream.value,
    submodules: submodules.value
  });
}

const argv = computed(() => pushArgvWith(force.value));

const canRun = computed(() =>
{
  if (!remote.value || busy.value)
  {
    return false;
  }
  if (tab.value === TAB_TAGS)
  {
    return allTags.value || tagName.value.trim().length > 0;
  }
  if (tab.value === TAB_ALL)
  {
    return true;
  }
  return from.value.trim().length > 0;
});

/** Everything asked before git is spawned, in the order the answers change the command. */
async function confirmed(): Promise<boolean>
{
  if (force.value === FORCE_PLAIN)
  {
    // The two flags look interchangeable and one of them silently destroys work.
    const ok = await ui.confirmUnlessSuppressed({
      title: 'Force without a lease?',
      message:
        '`--force` overwrites anything. `--force-with-lease` stops if the remote moved.',
      confirmLabel: 'Force anyway',
      danger: true,
      rememberKey: 'push.force'
    });
    if (!ok)
    {
      force.value = FORCE_LEASE;
      return false;
    }
  }

  if (isPushingWithoutTrackedUpstream(tab.value, hasUpstream.value, setUpstream.value, from.value))
  {
    const ok = await ui.confirmUnlessSuppressed({
      title: 'Set the tracking reference?',
      message: `\`${from.value}\` has no upstream. Without one, a later plain \`git push\` from a terminal fails with "no upstream configured": from a branch this dialog just pushed.`,
      confirmLabel: 'Push and set upstream',
      rememberKey: 'push.setUpstream'
    });
    if (ok)
    {
      setUpstream.value = true;
    }
  }

  return true;
}

/**
 * Set once a push comes back rejected: the window becomes a different question, not
 * the same form with more buttons. A state, not an addition, so a rejected push shows
 * one button, not four that all push.
 */
const rejected = ref(isRejectedPush(props.failure ?? ''));
const remedyChoice = ref<RejectionRemedy>(REMEDY_PULL_REBASE);

// A push that failed in another window arrives as text, read by the same predicate, so
// a handed-over rejection and one this dialog ran land on the same screen.
if (props.failure)
{
  error.value = props.failure;
}

const remedyOptions = computed<readonly RadioOption[]>(() =>
  REJECTION_REMEDIES.map((entry) => ({
    value: entry.remedy,
    label: entry.label,
    hint: entry.detail
  }))
);

const chosenRemedy = computed(() => rejectionRemedy(remedyChoice.value));

/**
 * What the chosen answer runs, previewed as the plan it is and executed from the same
 * array: "pull then push" was two `run` calls with no preview between them before.
 */
const remedySteps = computed(() =>
{
  if (remedyChoice.value === REMEDY_FORCE_LEASE)
  {
    return [{ label: 'Pushing', argv: pushArgvWith(FORCE_LEASE) }];
  }
  // The branch being pushed to, named explicitly: a bare `git pull origin` fails
  // outright on a branch with no upstream, the common case here.
  let pullAction: typeof PULL_REBASE | typeof PULL_MERGE;
  if (remedyChoice.value === REMEDY_PULL_REBASE)
  {
    pullAction = PULL_REBASE;
  }
  else
  {
    pullAction = PULL_MERGE;
  }
  return [
    {
      label: `Pulling from ${remote.value}`,
      argv: buildPullArgs({
        action: pullAction,
        remote: remote.value,
        remoteBranch: to.value || from.value
      })
    },
    { label: 'Pushing', argv: argv.value }
  ];
});

async function push(): Promise<void>
{
  if (!canRun.value)
  {
    return;
  }
  rejected.value = false;
  if (!(await confirmed()))
  {
    return;
  }

  // A push moves the remote-tracking refs that follow what the remote now has.
  // `console: true`: over the network, so what git says as it goes is the point.
  const ok = await run(argv.value, REFS, { close: false, console: true });
  if (ok)
  {
    close();
    return;
  }
  // git's rejection is not a failure of the dialog: it is the normal outcome of pushing
  // a branch someone else has moved, and it has three sensible answers.
  rejected.value = isRejectedPush(failureOutput.value);
}

async function applyRemedy(): Promise<void>
{
  // Reflected in the form as well: after this the window really is set to force with a
  // lease, and a radio still reading "Don't force" would be lying about what just ran.
  if (remedyChoice.value === REMEDY_FORCE_LEASE)
  {
    force.value = FORCE_LEASE;
  }
  const steps = remedySteps.value;
  rejected.value = false;

  if (await runSteps(steps, REFS, { close: false, console: true }))
  {
    close();
    return;
  }
  rejected.value = isRejectedPush(failureOutput.value);
}

async function loadRemoteHeads(): Promise<void>
{
  const path = repo.repo?.path;
  if (!path || !remote.value)
  {
    return;
  }
  try
  {
    remoteHeads.value = await api['remote:heads'](path, remote.value);
  }
  catch
  {
    // Offline is not a reason to refuse: the "would create" note simply goes quiet.
    remoteHeads.value = [];
  }
}

watch(remote, loadRemoteHeads);

onMounted(async () =>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  try
  {
    remotes.value = await api['remote:list'](path);
  }
  catch (err)
  {
    error.value = toMessage(err);
  }
  remote.value = localRef.value?.upstream?.split('/')[0] ?? defaultRemoteName(remotes.value);
  if (!from.value)
  {
    from.value = currentBranch.value ?? '';
  }
  await loadRemoteHeads();
});
</script>

<template>
  <DialogFrame title="Push" @close="emit('close')">
    <!-- The rejection, and the one decision left. In place of the form rather than under
         it: the question the window is asking has changed. -->
    <div v-if="rejected" class="form">
      <DangerNote tone="warning">
        <code>{{ remote }}</code> has commits
        <template v-if="tab === TAB_BRANCH && from"><code>{{ from }}</code></template>
        <template v-else>{{ tab === TAB_BRANCH ? 'this branch' : 'this push' }}</template>
        does not. git refused rather than discarding them.
      </DangerNote>

      <FormGroup label="What to do about it">
        <FormRadioGroup v-model="remedyChoice" :options="remedyOptions" />
      </FormGroup>

      <CommandPreview :steps="remedySteps" />
      <p v-if="error" class="hint">{{ error }}</p>
    </div>

    <div v-else class="form">
      <FormSelect
        v-model="remote"
        label="Remote"
        :options="remotes.map((entry) => ({ value: entry.name, label: entry.name }))"
        placeholder="Pick a remote…"
        :hint="remoteUrlHint"
      />

      <!-- The way to a remote not in the list yet. It opens *over* this window, which
           waits: the chain is the point, since two side-by-side modals would have no order between them. -->
      <FormRow indent>
        <button @click="ui.openDialog('remote.manage')">Manage remotes…</button>
      </FormRow>

      <!-- Three things you can push, not three dialogs. The tags tab is what replaced
           PushTagDialog: pushing a tag is a push, and the remote is already chosen here. -->
      <FormRadioGroup
        v-model="tab"
        inline
        :options="[
          { value: TAB_BRANCH, label: 'A branch' },
          { value: TAB_TAGS, label: 'Tags' },
          { value: TAB_ALL, label: 'Every branch' }
        ]"
      />

      <template v-if="tab === TAB_BRANCH">
        <FormText v-model="from" label="Push" placeholder="branch or HEAD" />
        <p v-if="wouldCreate" class="hint">
          <code>{{ to || from }}</code> does not exist on <code>{{ remote }}</code> yet:
          this push creates it.
        </p>
      </template>

      <template v-else-if="tab === TAB_TAGS">
        <FormCheck v-model="allTags" label="Every tag" hint="`--tags`" />
        <FormText
          v-if="!allTags"
          v-model="tagName"
          label="Tag"
          placeholder="v1.0"
          hint="Pushed as `tag <name>`, never a branch of that name."
        />
      </template>

      <p v-else class="hint">
        <code>--all</code>: every local branch, upstream or not.
      </p>

      <!-- Everything past "push this branch to this remote": folded, since that sentence
           is the whole of what this window does almost every time it's opened. -->
      <FormDisclosure v-model="showOptions" :summary="optionsSummary">
        <FormText
          v-if="tab === TAB_BRANCH"
          v-model="to"
          label="To"
          :placeholder="from || 'the same name'"
          hint="Only when the remote name differs: the `:` in a refspec."
        />
        <FormCheck
          v-if="tab === TAB_BRANCH"
          v-model="setUpstream"
          label="Track this remote branch afterwards"
          :disabled="hasUpstream"
          :hint="
            hasUpstream
              ? `Already tracking \`${localRef?.upstream}\`.`
              : '`-u`, so a later plain `git push` works.'
          "
        />

        <FormGroup label="How hard">
          <FormRadioGroup v-model="force" :options="forceOptions" />
        </FormGroup>

        <FormGroup v-if="tab !== TAB_TAGS" label="Submodules">
          <FormRadioGroup v-model="submodules" :options="SUBMODULE_OPTIONS" />
        </FormGroup>
      </FormDisclosure>

      <!-- Outside the fold on purpose: a warning that can be folded away is not one. -->
      <DangerNote v-if="force === FORCE_PLAIN">
        Anything pushed since your last fetch is gone, silently.
      </DangerNote>

      <CommandPreview :argv="argv" placeholder="Pick a remote first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <template v-if="rejected">
        <!-- The way back to the form: the other answer to a rejection is to push
             something else, or somewhere else. -->
        <button :disabled="busy" @click="rejected = false">Change the push</button>
        <button
          :class="chosenRemedy.danger ? 'danger' : 'primary'"
          :disabled="busy"
          @click="applyRemedy"
        >
          {{ busy ? 'Working…' : chosenRemedy.label }}
        </button>
      </template>
      <button
        v-else
        :class="force === FORCE_PLAIN ? 'danger' : 'primary'"
        :disabled="!canRun"
        @click="push"
      >
        {{ busy ? 'Pushing…' : 'Push' }}
      </button>
    </template>
  </DialogFrame>
</template>
