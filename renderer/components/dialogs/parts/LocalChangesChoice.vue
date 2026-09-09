<script setup lang="ts">
/**
 * Choices for uncommitted changes blocking a checkout. Stash is a pre-op; Branch is the fifth (keep work elsewhere).
 */

import { computed } from 'vue';
import {
  ENDS_ON_TARGET,
  LOCAL_CHANGE_BRANCHES,
  LOCAL_CHANGES_BRANCH,
  type LocalChangesBranchMode,
  type LocalChangesChoiceValue
} from '@renderer/model/args/checkout.js';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormText from '@renderer/components/ui/FormText.vue';

const CHOICE_BRANCH = LOCAL_CHANGES_BRANCH;

const model = defineModel<LocalChangesChoiceValue>({ required: true });
/** Which of the three branch strategies, when `branch` is the choice. */
const branchMode = defineModel<LocalChangesBranchMode>('branchMode', { default: 'commit' });
/** The branch to create. Required by all three, which is why it is one field. */
const branchName = defineModel<string>('branchName', { default: '' });

const props = withDefaults(
  defineProps<{
    /** Hidden entirely when the working tree is clean. */
    dirty?: boolean;
    /** What the changes are about to be carried into, for the hints. */
    verb?: string;
    /** The ref being checked out, so "where you end up" can name it. */
    target?: string;
  }>(),
  { dirty: true, verb: 'checkout', target: '' }
);

/**
 * Toned like the reset dialog's modes, and for the same reason: these differ in exactly
 * one thing that matters, which is what happens to work you have not committed. Two of
 * them cannot lose anything, one leaves conflict markers to sort out, and one deletes
 * changes git has never seen. The group is toned because *Reset* here is `--force`, which
 * is the same act as `--hard` under a gentler word.
 */
const options: readonly RadioOption[] = [
  {
    value: 'none',
    label: "Don't change",
    hint: 'Let git refuse if the changes are in the way.',
    tone: 'safe'
  },
  {
    value: 'merge',
    label: 'Merge',
    hint: '`--merge`, carry the changes across.',
    tone: 'caution'
  },
  {
    value: 'stash',
    label: 'Stash',
    hint: '`git stash` first, and offer to pop it afterwards.',
    tone: 'safe'
  },
  {
    value: 'branch',
    label: 'Put them on a branch',
    // No hint: picking it opens the three strategies, each of which is its own
    // explanation, and a line here pushes the command preview below the fold on a
    // laptop-sized window.
    tone: 'safe'
  },
  {
    value: 'reset',
    label: 'Reset',
    hint: '`--force`, throw the changes away. They are not recoverable.',
    tone: 'danger'
  }
];

const branchOptions = computed<readonly RadioOption[]>(() =>
  LOCAL_CHANGE_BRANCHES.map((entry) => ({
    value: entry.mode,
    label: entry.label,
    hint: entry.detail
  }))
);

/**
 * Where the chosen strategy leaves you, named.
 *
 * One line that changes with the choice rather than a clause inside all three hints: it
 * is the only thing that differs between them in a way you can be surprised by, and three
 * paragraphs saying it in passing pushed the command preview off the bottom of the window
 *, which is the one thing this app does not hide.
 */
const endsOn = computed(() =>
{
  const entry = LOCAL_CHANGE_BRANCHES.find((info) => info.mode === branchMode.value);
  let name;
  if (entry?.endsOn === ENDS_ON_TARGET)
  {
    name = props.target;
  }
  else
  {
    name = branchName.value.trim();
  }
  return name || null;
});
</script>

<template>
  <FormGroup label="Local changes" :collapsed="!dirty">
    <FormRadioGroup v-model="model" :options="options" />

    <!-- Nested rather than seven radios in one list: the three are a follow-up question,
         and they only exist once the answer to the first one is "a branch". -->
    <FormGroup v-if="model === CHOICE_BRANCH" label="How">
      <FormRadioGroup v-model="branchMode" :options="branchOptions" />
      <FormText v-model="branchName" label="New branch" placeholder="wip/my-changes" />
      <p v-if="endsOn" class="hint">You end up on <code>{{ endsOn }}</code>.</p>
    </FormGroup>
  </FormGroup>
</template>
