<script setup lang="ts">
/**
 * `git gc`: compressing the object database. An ordinary `useDialog` form, with the
 * console forced on: the run is a minute of repacking with nothing else to show for it,
 * and `runner.ts` spawns `gc` inside a pty so there is progress to watch at all.
 */

import { computed, ref } from 'vue';
import { buildGcArgs, type GcOptions } from '@renderer/model/args/maintenance.js';
import { flagsIn } from '@renderer/model/args/summary.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormDisclosure from '@renderer/components/ui/FormDisclosure.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';

const emit = defineEmits<{ close: [] }>();

const { busy, error, run } = useDialog();

const aggressive = ref(false);
const prune = ref('');

const options = computed<GcOptions>(() => ({
  aggressive: aggressive.value,
  prune: prune.value
}));

const argv = computed(() => buildGcArgs(options.value));

// Summary from argv: can't drift from what runs.
const summary = computed(() => flagsIn(argv.value));

// gc expires reflog entries: grid must reload commits when reflog is shown.
const FACETS = ['commits'] as const;
</script>

<template>
  <DialogFrame title="Compress Git Database" @close="emit('close')">
    <div class="form">
      <p class="hint">
        Repacks loose objects and drops unreachable ones. Safe at any time; worth it after a
        large fetch or a rewrite.
      </p>

      <FormDisclosure label="Options" :summary="summary">
        <FormCheck
          v-model="aggressive"
          label="Repack from scratch"
          hint="`--aggressive`: much slower. After a rewrite or import."
        />
        <FormText
          v-model="prune"
          label="Delete objects older than"
          placeholder="Empty means git's default of 2.weeks.ago"
          hint="`--prune=<date>`: how old an object must be to go."
        />
      </FormDisclosure>

      <CommandPreview :argv="argv" />

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Close</button>
      <button class="primary" :disabled="busy" @click="run(argv, FACETS, { console: true })">
        {{ busy ? 'Compressing…' : 'Run' }}
      </button>
    </template>
  </DialogFrame>
</template>
