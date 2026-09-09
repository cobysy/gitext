<script setup lang="ts">
/**
 * Create a tag, lightweight or annotated (the choice decides whether a message field
 * shows). Pushing is on the same window: a tag nobody else can see is half the job, and
 * `git push --tags` from a terminal pushes every tag, including ones not meant to go.
 */

import { computed, ref, watch } from 'vue';
import { api } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import { buildCreateTagArgs, TAG_KINDS, type TagKind } from '@renderer/model/args/tag.js';
import { buildPushTagArgs } from '@renderer/model/args/push.js';
import type { ArgvStep } from '@renderer/model/args/checkout.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { summaryOf } from '@renderer/model/args/summary.js';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';
import CommitSummary from '@renderer/components/dialogs/parts/CommitSummary.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const props = defineProps<{
  /** The commit to tag. `HEAD` when nothing named one. */
  gitRef?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const { busy, error, perform } = useDialog();

// Tag kind constants
const TAG_KIND_ANNOTATED = 'annotated';
const TAG_EDITMSG_FILE = 'TAG_EDITMSG';
const PUSH_FORCE_MODE = 'force';
const PUSH_NONE_MODE = 'none';
const KIND_TAG = 'tag';

const name = ref('');
const commit = computed(() => props.gitRef ?? HEAD_REF);
const kind = ref<TagKind>(TAG_KIND_ANNOTATED);
const message = ref('');
const force = ref(false);
const pushTo = ref('');
const showOptions = ref(false);

/** What the fold is carrying, said in the dialog's own words rather than in git's flags. */
const optionsSummary = computed(() =>
{
  let kindPart: string;
  if (kind.value === TAG_KIND_ANNOTATED)
  {
    kindPart = '';
  }
  else
  {
    kindPart = kindInfo.value?.label.toLowerCase() ?? '';
  }
  let forcePart: string;
  if (force.value)
  {
    forcePart = 'overwrite';
  }
  else
  {
    forcePart = '';
  }
  let pushPart: string;
  if (pushTo.value)
  {
    pushPart = `push to ${pushTo.value}`;
  }
  else
  {
    pushPart = '';
  }
  return summaryOf([kindPart, forcePart, pushPart]);
});

const kindInfo = computed(() => TAG_KINDS.find((entry) => entry.kind === kind.value));
const takesMessage = computed(() => kindInfo.value?.message === true);

/**
 * An annotated tag with no message is a command that cannot succeed. `-a` and no `-F`
 * sends git to an editor, and the editor a spawn here gets writes nothing, so git answers
 * `no tag message?`. The form refuses the state rather than letting git refuse it.
 */
const missingMessage = computed(() => takesMessage.value && !message.value.trim());

const kindOptions: readonly RadioOption[] = TAG_KINDS.map((entry) => ({
  value: entry.kind,
  label: entry.label,
  hint: entry.detail
}));

// A lightweight tag has nowhere to put a message; keeping the text around would mean a
// preview with `-F` in it the moment the kind changed back.
watch(takesMessage, (value) =>
{
  if (!value)
  {
    message.value = '';
  }
});

const existing = computed(() => objects.refs.filter((entry) => entry.kind === KIND_TAG));
const wouldOverwrite = computed(() =>
  existing.value.some((entry) => entry.name === name.value.trim())
);

const remotes = computed(() => objects.remotes.map((entry) => entry.name));

/**
 * The message file's path as it *will* be: same reasoning as the merge dialog: writing
 * it on every keystroke would leave a `TAG_EDITMSG` behind for a dialog that was cancelled.
 */
const messagePath = computed(() =>
{
  if (takesMessage.value && message.value.trim())
  {
    return `${repo.repo?.gitDir ?? '.git'}/${TAG_EDITMSG_FILE}`;
  }
  else
  {
    return null;
  }
}
);

const steps = computed<ArgvStep[]>(() =>
{
  if (!name.value.trim())
  {
    return [];
  }
  const steps: ArgvStep[] = [
    {
      label: 'Creating the tag',
      argv: buildCreateTagArgs({
        name: name.value,
        commit: commit.value,
        kind: kind.value,
        messageFile: messagePath.value,
        force: force.value
      })
    }
  ];
  if (pushTo.value)
  {
    let pushForce: typeof PUSH_FORCE_MODE | typeof PUSH_NONE_MODE;
    if (force.value)
    {
      pushForce = PUSH_FORCE_MODE;
    }
    else
    {
      pushForce = PUSH_NONE_MODE;
    }
    steps.push({
      label: 'Pushing the tag',
      argv: buildPushTagArgs({
        remote: pushTo.value,
        tag: name.value.trim(),
        force: pushForce
      })
    });
  }
  return steps;
});

async function create(): Promise<void>
{
  if (!name.value.trim() || missingMessage.value || busy.value)
  {
    return;
  }

  await perform('Creating the tag', async (repoPath) =>
  {
    if (messagePath.value)
    {
      await api['git:writeMessageFile'](repoPath, TAG_EDITMSG_FILE, message.value);
    }
    await runConsoleSteps(repoPath, steps.value, REFS);
  });
}
</script>

<template>
  <DialogFrame title="Create Tag" @close="emit('close')">
    <div class="form">
      <CommitSummary :rev="commit" label="Tagging" />

      <FormText v-model="name" label="Tag name" placeholder="v1.0.0" />
      <p v-if="wouldOverwrite && !force" class="warn">
        A tag called <code>{{ name.trim() }}</code> already exists. Tick Overwrite, or pick
        another name.
      </p>

      <FormTextArea
        v-model="message"
        label="Message"
        :rows="3"
        :disabled="!takesMessage"
        :hint="
          takesMessage
            ? '`-F .git/TAG_EDITMSG`: a body survives.'
            : 'A lightweight tag has nowhere to put one.'
        "
      />
      <p v-if="missingMessage && name.trim()" class="warn">
        An annotated tag has to carry a message. Write one, or pick Lightweight.
      </p>

      <!-- A name and a message is the whole of it nearly every time. What kind of tag,
           whether it replaces one, and where it goes are the rest. -->
      <FormDisclosure v-model="showOptions" :summary="optionsSummary">
        <FormGroup label="Kind">
          <FormRadioGroup v-model="kind" :options="kindOptions" />
        </FormGroup>

        <FormCheck
          v-model="force"
          label="Overwrite a tag of the same name"
          hint="`-f`: the pushed copy is untouched."
        />

        <FormSelect
          v-model="pushTo"
          label="Push it to"
          :options="[
            { value: '', label: 'Leave it local' },
            ...remotes.map((entry) => ({ value: entry, label: entry }))
          ]"
          hint="Pushes this tag alone, not every tag."
        />
      </FormDisclosure>

      <CommandPreview :steps="steps" placeholder="Enter a tag name first" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!name.trim() || missingMessage || busy" @click="create">
        {{ busy ? 'Creating…' : 'Create Tag' }}
      </button>
    </template>
  </DialogFrame>
</template>
