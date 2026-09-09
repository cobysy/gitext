<script setup lang="ts">
/**
 * Delete tag: local delete alone doesn't matter (tag returns on fetch from remote).
 * Dialog shows which remotes actually have it, not guessing.
 */

import { computed, onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';
import { buildDeleteRemoteRefArgs, buildDeleteTagArgs } from '@renderer/model/args/tag.js';
import type { ArgvStep } from '@renderer/model/args/checkout.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import { READS, REFS } from '@shared/invalidation.js';

const props = defineProps<{ tagName: string }>();
const emit = defineEmits<{ close: [] }>();

const repo = useRepoStore();
const objects = useRepoObjectsStore();
const { busy, error, runSteps } = useDialog();

/** Read-only, but a field's value is still state: `FormText` binds with `v-model`. */
const tagName = ref(props.tagName);
/** Remotes to delete from: Set (not record of booleans) to avoid three-state checkbox. */
const alsoOn = ref<ReadonlySet<string>>(new Set());

function choose(remote: string, on: boolean): void
{
  const next = new Set(alsoOn.value);
  if (on)
  {
    next.add(remote);
  }
  else
  {
    next.delete(remote);
  }
  alsoOn.value = next;
}

/** Remotes that actually have this tag, so the box is only offered where it would act. */
const hasTag = ref<ReadonlySet<string>>(new Set());

const remotes = computed(() => objects.remotes.map((entry) => entry.name));

const steps = computed<ArgvStep[]>(() =>
{
  const chosen = remotes.value.filter((name) => alsoOn.value.has(name));
  return [
    { label: 'Deleting the tag', argv: buildDeleteTagArgs([props.tagName]) },
    ...chosen.map((remote) => ({
      label: `Deleting it on ${remote}`,
      argv: buildDeleteRemoteRefArgs(remote, [props.tagName])
    }))
  ];
});

const anyRemote = computed(() => alsoOn.value.size > 0);

onMounted(async () =>
{
  const path = repo.repo?.path;
  if (!path)
  {
    return;
  }
  // Which remotes actually have it. Guessing is how a tag comes back on the next fetch:
  // and offering a box for a remote that does not have it is a command that only errors.
  const found = new Set<string>();
  for (const remote of remotes.value)
  {
    try
    {
      const output = await api['git:run'](
        path,
        ['ls-remote', '--tags', remote, props.tagName],
        READS
      );
      if (output.trim())
      {
        found.add(remote);
      }
    }
    catch
    {
      // Offline: offer it anyway rather than hiding a remote that probably has it.
      found.add(remote);
    }
  }
  hasTag.value = found;
});
</script>

<template>
  <DialogFrame title="Delete Tag" @close="emit('close')">
    <div class="form">
      <FormText v-model="tagName" label="Tag" readonly />

      <FormCheck
        v-for="remote in remotes.filter((entry) => hasTag.has(entry))"
        :key="remote"
        :model-value="alsoOn.has(remote)"
        :label="`Delete it on ${remote} too`"
        hint="`push --delete`: otherwise it returns on fetch."
        @update:model-value="(on: boolean) => choose(remote, on)"
      />

      <DangerNote v-if="anyRemote">
        Deletes it for everybody. Anyone who fetched it keeps their copy.
      </DangerNote>

      <CommandPreview :steps="steps" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="danger" :disabled="busy" @click="runSteps(steps, REFS)">
        {{ busy ? 'Deleting…' : 'Delete Tag' }}
      </button>
    </template>
  </DialogFrame>
</template>
