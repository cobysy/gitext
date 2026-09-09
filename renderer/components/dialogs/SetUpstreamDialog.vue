<script setup lang="ts">
/**
 * Set branch upstream. Upstream is what git status counts against, what
 * bare git pull fetches. Picker's first row is 'nothing'.
 */

import { computed, ref, watch } from 'vue';
import { buildSetUpstreamArgs, buildUnsetUpstreamArgs } from '@renderer/model/args/branch.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import RefPicker from '@renderer/components/dialogs/parts/RefPicker.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { REFS } from '@shared/invalidation.js';
import { REF_KIND_BRANCH, REF_KIND_REMOTE } from '@shared/types.js';

const props = defineProps<{ branchName: string }>();
const emit = defineEmits<{ close: [] }>();

const objects = useRepoObjectsStore();
const { busy, error, run } = useDialog();

/** Read-only field still needs state for v-model binding. */
const branch = ref(props.branchName);

const entry = computed(() =>
  objects.refs.find(
    (ref) => ref.kind === REF_KIND_BRANCH && ref.name === props.branchName
  )
);

/** Current upstream, or empty string for nothing. */
const tracked = computed(() => entry.value?.upstream ?? '');

/** Configured but remote no longer has it: git's "gone". */
const gone = computed(() => entry.value?.upstreamGone === true);

const chosen = ref(tracked.value);

// Repo arrives after props: update chosen if it changed, preserve manual choice.
watch(tracked, (now, before) =>
{
  if (chosen.value === before)
  {
    chosen.value = now;
  }
});

const argv = computed(() =>
{
  if (chosen.value === tracked.value)
  {
    return [];
  }
  if (chosen.value)
  {
    return buildSetUpstreamArgs(props.branchName, chosen.value);
  }
  else
  {
    return buildUnsetUpstreamArgs(props.branchName);
  }
});

/**
 * Button says the command, not the window: set vs clear are two commands.
 */
const actionLabel = computed(() =>
{
  if (chosen.value)
  {
    if (busy.value)
    {
      return 'Setting…';
    }
    else
    {
      return 'Set Upstream';
    }
  }
  if (busy.value)
  {
    return 'Clearing…';
  }
  else
  {
    return 'Stop Tracking';
  }
});

/** Both spellings update branch config. */
async function apply(): Promise<void>
{
  if (!argv.value.length || busy.value)
  {
    return;
  }
  await run(argv.value, REFS);
}
</script>

<template>
  <DialogFrame title="Set Upstream" @close="emit('close')">
    <div class="form">
      <FormText v-model="branch" label="Branch" readonly />
      <RefPicker
        v-model="chosen"
        :kinds="[REF_KIND_REMOTE]"
        :extra="tracked"
        label="Tracks"
        none="Nothing: no upstream"
        hint="What a bare `git pull` reads, and what ahead/behind counts against."
      />

      <p v-if="gone" class="warn">
        <code>{{ tracked }}</code> is configured but no longer on the remote.
      </p>

      <CommandPreview :argv="argv" placeholder="Pick a different upstream" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!argv.length || busy" @click="apply">
        {{ actionLabel }}
      </button>
    </template>
  </DialogFrame>
</template>
