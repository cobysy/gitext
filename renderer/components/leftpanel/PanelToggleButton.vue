<script setup lang="ts">
/** Hides and shows the left panel. Drawn in its filter strip and on the rail. */

import { computed } from 'vue';
import { getCommand, runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { formatAccelerator } from '@renderer/keys.js';

const COMMAND_ID = 'view.toggleLeftPanel';

const props = withDefaults(defineProps<{ hoverLabel?: boolean }>(), { hoverLabel: false });

const context = useCommandContext();

const command = computed(() => getCommand(COMMAND_ID));

const shown = computed(() => command.value?.checked?.(context.value) ?? false);

const label = computed(() =>
{
  if (shown.value)
  {
    return 'Hide the left panel';
  }
  else
  {
    return 'Show the left panel';
  }
});

const title = computed(() =>
{
  const key = command.value?.keys?.[0];
  if (!key)
  {
    return label.value;
  }
  return `${label.value} (${formatAccelerator(key)})`;
});

const nativeTitle = computed(() =>
{
  if (props.hoverLabel)
  {
    return undefined;
  }
  return title.value;
});

function onClick(): void
{
  void runCommand(COMMAND_ID, context.value);
}
</script>

<template>
  <button
    class="toggle"
    :class="{ back: shown, 'has-label': props.hoverLabel }"
    type="button"
    :title="nativeTitle"
    :aria-label="label"
    @click="onClick"
  >
    <span v-if="props.hoverLabel" class="flyout">{{ title }}</span>

    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path
        d="M4 2.5 8 6l-4 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>

<style scoped src="@renderer/styles/hoverLabel.css"></style>
<style scoped>
.toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: default;
}

.toggle:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.toggle.back svg {
  transform: scaleX(-1);
}
</style>
