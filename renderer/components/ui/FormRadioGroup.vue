<script setup lang="ts">
/**
 * Radio group for mutually exclusive choices: reset mode, local changes, conflict resolution.
 * Radios show all options (better for uncertain choices); name auto-generated via useId.
 */

import CodeText from './CodeText.vue';
import HintText from './HintText.vue';
import { useId } from 'vue';
import type { Tone } from '@renderer/model/tone.js';

export interface RadioOption<T extends string = string> {
  value: T;
  label: string;
  /** What choosing this actually does, including the git flag it becomes. */
  hint?: string;
  disabled?: boolean;
  /**
   * Cost of this choice: tinted edge (e.g. reset modes: green, amber, red).
   * Use sparingly; decoration on costless choices stops warnings being read.
   */
  tone?: Tone;
}

const model = defineModel<string>({ required: true });

defineProps<{
  options: readonly RadioOption[];
  /** Lay the options out in a row: for two short ones, like local/remote. */
  inline?: boolean;
}>();

const name = `radio-${useId()}`;
</script>

<template>
  <div class="group" :class="{ inline }" role="radiogroup">
    <label
      v-for="option in options"
      :key="option.value"
      class="option"
      :class="[option.disabled && 'disabled', option.tone && `tone-${option.tone}`]"
    >
      <input
        v-model="model"
        type="radio"
        :name="name"
        :value="option.value"
        :disabled="option.disabled"
      />
      <span class="text">
        <span><CodeText :text="option.label" /></span>
        <HintText v-if="option.hint" :text="option.hint" />
      </span>
    </label>
  </div>
</template>

<style scoped src="@renderer/styles/controlText.css"></style>
<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.group.inline {
  flex-direction: row;
  gap: var(--space-4);
}

.option {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.option.disabled {
  opacity: 0.5;
}

/* A strip down the edge, in the option's own colour. `--tone` is set per class and every
   rule below reads it, so a fourth tone is one line here rather than a fourth ruleset. */
.option.tone-safe {
  --tone: var(--success);
}

.option.tone-caution {
  --tone: var(--warning);
}

.option.tone-danger {
  --tone: var(--danger);
}

.option[class*='tone-'] {
  padding: var(--space-1) var(--space-2);
  border-left: 3px solid var(--tone);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: color-mix(in srgb, var(--tone) 8%, transparent);
}

</style>
