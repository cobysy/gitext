<script setup lang="ts">
/**
 * Pull and fetch. The constraints in the shape are git's rather than the dialog's:
 * pruning is a fetch-side operation, `[ All ]` cannot mean "merge all of them into this
 * branch", and a local-branch refspec is meaningless when git would write to the branch
 * already checked out.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import {
  buildPullArgs,
  PULL_ACTION_FETCH,
  PULL_ACTIONS,
  type PullAction,
  type TagFetchMode
} from '@renderer/model/args/pull.js';
import { buildAutoStashArgs, buildStashPopArgs, type ArgvStep } from '@renderer/model/args/checkout.js';
import { defaultRemoteName } from '@renderer/model/remoteDefaults.js';
import type { RemoteEntry } from '@shared/types.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { buildRemotePruneArgs } from '@renderer/model/args/remote.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { flagsIn, summaryOf } from '@renderer/model/args/summary.js';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormRow from '@renderer/components/ui/FormRow.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { HISTORY_MOVE, READS, type RepoFacet } from '@shared/invalidation.js';

const props = defineProps<{
  /** The remote a surface named: the left panel's remote node, usually. */
  remoteName?: string;
  /** A remote branch to fetch or pull, when one was named. */
  gitRef?: string;
  /** What to open set to. The surface decides: the fetch rows say `fetch`, *Fetch and Rebase* says `rebase`. Absent means "whatever was used last". */
  action?: PullAction;
  /** Open with pruning already ticked: the left panel's *Fetch and Prune* row. */
  prune?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { busy, error, runSteps, run, close } = useDialog();

/** `[ All ]` is git's own `--all`-ish idiom here: every remote, one after another. */
const ALL_REMOTES = '--all';

const remotes = ref<RemoteEntry[]>([]);
const remote = ref(props.remoteName ?? '');
const remoteBranch = ref(props.gitRef ?? '');
const localBranch = ref('');
const action = ref<PullAction>(props.action ?? settings.settings.pullAction);
const tags = ref<TagFetchMode>('default');
const prune = ref(props.prune ?? false);
const pruneTags = ref(false);
/**
 * Open on the fold when the surface that opened this window set something inside it: the
 * left panel's *Fetch and Prune* row arrives with `prune` already ticked, and a folded
 * panel holding the thing the row was named for would be hiding its own answer.
 */
const showOptions = ref(Boolean(props.prune) || Boolean(props.gitRef));
const unshallow = ref(false);
const autostash = ref(settings.settings.pullAutostash);

const isAll = computed(() => remote.value === ALL_REMOTES);
const dirty = computed(() => (repo.status?.files.length ?? 0) > 0);
const shallow = ref(false);

/**
 * `[ All ]` forces fetch-only: "merge every remote's version of this branch into it"
 * isn't an operation, and `git pull --all` fetches everything but merges only the
 * upstream, which is a different thing from what the row appears to offer.
 */
watch(isAll, (value) =>
{
  if (value)
  {
    action.value = PULL_ACTION_FETCH;
  }
});

// Pruning is a fetch-side operation. `git pull --prune` is legal, but offering it beside a merge would imply the merge is what prunes.
watch(action, (value) =>
{
  if (value !== PULL_ACTION_FETCH)
  {
    prune.value = false;
    pruneTags.value = false;
    unshallow.value = false;
    localBranch.value = '';
  }
});

watch(pruneTags, (value) =>
{
  if (value)
  {
    prune.value = true;
  }
});

const remoteOptions = computed(() =>
{
  const options = remotes.value.map((entry) => ({ value: entry.name, label: entry.name }));
  // Offered whenever there is a remote at all, not only when there are several: the toolbar's "Fetch All Remotes" opens the dialog on it.
  if (remotes.value.length)
  {
    options.push({ value: ALL_REMOTES, label: '[ All remotes ]' });
  }
  return options;
});

const actionOptions = computed<readonly RadioOption[]>(() =>
  PULL_ACTIONS.map((entry) => ({
    value: entry.action,
    label: entry.label,
    hint: entry.detail,
    disabled: isAll.value && entry.action !== PULL_ACTION_FETCH
  }))
);

const tagOptions: readonly RadioOption[] = [
  {
    value: 'default',
    label: 'Whatever the remote is configured for',
    hint: "git's default, tags on what it downloads."
  },
  { value: 'none', label: 'No tags', hint: '`--no-tags`' },
  { value: 'all', label: 'All tags', hint: '`--tags`, including ones on branches you do not track.' }
];

const argv = computed(() =>
{
  let effectiveRemote: string;
  if (isAll.value)
  {
    effectiveRemote = ALL_REMOTES;
  }
  else
  {
    effectiveRemote = remote.value;
  }
  return buildPullArgs({
    action: action.value,
    remote: effectiveRemote,
    remoteBranch: remoteBranch.value,
    localBranch: localBranch.value,
    tags: tags.value,
    unshallow: unshallow.value,
    prune: prune.value,
    pruneTags: pruneTags.value
  });
});

/** What the folded panel is carrying, minus the flags the visible controls already produce (the action radios, and `--progress` on every command). */
/** The stash round trip, this app's own rather than git's: see the checkout dialog. */
const willStash = computed(() => action.value !== PULL_ACTION_FETCH && autostash.value && dirty.value);

const optionsSummary = computed(() =>
{
  let stashNote: string;
  if (willStash.value)
  {
    stashNote = 'stash and put back';
  }
  else
  {
    stashNote = '';
  }
  return summaryOf([
    remoteBranch.value.trim(),
    flagsIn(argv.value, ['--progress', '--rebase', '--no-rebase']),
    stashNote
  ]);
});

const steps = computed(() =>
{
  const list: ArgvStep[] = [];
  if (willStash.value)
  {
    list.push({
      label: 'Stashing your changes',
      argv: buildAutoStashArgs(settings.settings.autoStashUntracked)
    });
  }
  let actionLabel: string;
  if (action.value === PULL_ACTION_FETCH)
  {
    actionLabel = 'Fetching';
  }
  else
  {
    actionLabel = 'Pulling';
  }
  list.push({ label: actionLabel, argv: argv.value });
  return list;
});

async function go(): Promise<void>
{
  if (busy.value)
  {
    return;
  }
  await settings.patch({
    pullAction: action.value,
    pullAutostash: autostash.value
  });

  const stashed = willStash.value;
  // A pull is a fetch then a merge or rebase, so it can move everything; stashing first adds an entry to put back afterwards.
  let invalidates: readonly RepoFacet[];
  if (willStash.value)
  {
    invalidates = [...HISTORY_MOVE, 'stashes'];
  }
  else
  {
    invalidates = HISTORY_MOVE;
  }
  // `console: true`: a fetch over the network is the case for watching it work.
  const ok = await runSteps(steps.value, invalidates, { close: !stashed, console: true });
  if (!ok)
  {
    // git's own suggestion when a tracking ref is in the way of one being created: offered rather than described, since it's not a command a person is expected to know.
    if (/stale|would clobber existing tag|already exists/i.test(error.value) && remote.value)
    {
      error.value += `\n\nRun ${buildRemotePruneArgs(remote.value).join(' ')} to clear the stale refs, then try again.`;
    }
    return;
  }
  if (!stashed)
  {
    return;
  }

  const reapply = await ui.confirmUnlessSuppressed({
    title: 'Re-apply your changes?',
    message: 'Your changes were stashed. Pop them back on top?',
    confirmLabel: 'Pop the stash',
    rememberKey: 'pull.reapplyStash'
  });
  if (reapply && !(await run(buildStashPopArgs(), ['stashes', 'worktree', 'index'], { close: false })))
  {
    return;
  }
  close();
}

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
  if (!remote.value)
  {
    remote.value = defaultRemoteName(remotes.value);
  }
  // `--unshallow` on a non-shallow repository is an error, so the row exists only when it
  // would do something. One cheap read rather than looking for `.git/shallow`, which a worktree or submodule keeps elsewhere.
  try
  {
    shallow.value =
      (await api['git:run'](path, ['rev-parse', '--is-shallow-repository'], READS)).trim() ===
      'true';
  }
  catch
  {
    shallow.value = false;
  }
});
</script>

<template>
  <DialogFrame title="Pull / Fetch" @close="emit('close')">
    <div class="form">
      <FormSelect
        v-model="remote"
        label="Remote"
        :options="remoteOptions"
        placeholder="Pick a remote…"
      />

      <!-- The way to a remote not in the list yet, or one whose URL is wrong. Opens over
           this window, which waits: see the same button in `PushDialog` for why. -->
      <FormRow indent>
        <button @click="ui.openDialog('remote.manage')">Manage remotes…</button>
      </FormRow>

      <FormGroup label="What to do with it">
        <FormRadioGroup v-model="action" :options="actionOptions" />
        <p v-if="isAll" class="hint">
          Every remote at once can only be fetched, not merged.
        </p>
      </FormGroup>

      <!-- "Pull from origin" is what this window is opened for; naming a refspec, tags
           and pruning are the rest of what fetch can be told, folded away from the one decision above. -->
      <FormDisclosure v-model="showOptions" :summary="optionsSummary">
        <FormText
          v-model="remoteBranch"
          label="Remote branch"
          placeholder="Leave empty for the configured refspec"
          :hint="
            action === PULL_ACTION_FETCH
              ? 'One branch instead of everything the remote offers.'
              : 'Leave empty to pull whatever this branch tracks.'
          "
        />
        <FormText
          v-if="action === PULL_ACTION_FETCH"
          v-model="localBranch"
          label="Into local branch"
          placeholder="Leave empty for the tracking ref"
          hint="Writes straight into a local branch. Never the checked-out one."
        />

        <FormGroup label="Tags">
          <FormRadioGroup v-model="tags" :options="tagOptions" />
        </FormGroup>

        <FormCheck
          v-model="prune"
          label="Delete tracking refs"
          :disabled="action !== PULL_ACTION_FETCH"
          :hint="
            action === PULL_ACTION_FETCH
              ? '`--prune --force`: drops refs deleted on the remote.'
              : 'Only when fetching.'
          "
        />
        <FormCheck
          v-model="pruneTags"
          label="Delete tags gone from the remote"
          :disabled="action !== PULL_ACTION_FETCH"
          hint="`--prune-tags`"
        />
        <FormCheck
          v-if="shallow"
          v-model="unshallow"
          label="Download the full history"
          :disabled="action !== PULL_ACTION_FETCH"
          hint="`--unshallow`: this is a shallow clone."
        />
        <FormCheck
          v-model="autostash"
          label="Stash uncommitted changes and offer them back"
          :disabled="action === PULL_ACTION_FETCH || !dirty"
          :hint="
            action === PULL_ACTION_FETCH
              ? 'A fetch touches nothing in the working tree.'
              : dirty
                ? 'Stashes before, and asks afterwards whether to pop.'
                : 'Nothing uncommitted to stash.'
          "
        />
      </FormDisclosure>

      <CommandPreview :steps="steps" placeholder="Pick a remote first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="busy || !remote" @click="go">
        {{ busy ? 'Running…' : action === PULL_ACTION_FETCH ? 'Fetch' : 'Pull' }}
      </button>
    </template>
  </DialogFrame>
</template>
