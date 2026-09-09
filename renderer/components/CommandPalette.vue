<script setup lang="ts">
/**
 * Ctrl+P command palette.
 *
 * Renders the same registry the menus do, filtered by a subsequence match so
 * "cmlg" finds "Toggle Command Log".
 */

import { computed, nextTick, ref, watch } from 'vue';
import {
  availableCommands,
  runCommand,
  type CommandContext,
  type CommandDef
} from '@renderer/commands/registry.js';
import { formatAccelerator } from '@renderer/keys.js';
import { useUiStore } from '@renderer/stores/ui.js';

const props = defineProps<{ context: CommandContext }>();

const ui = useUiStore();
const query = ref('');
const selected = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

/** Fuzzy subsequence match; returns a score where lower is a tighter match. */
function score(text: string, needle: string): number | null
{
  if (!needle)
  {
    return 0;
  }
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  let index = 0;
  let previous = -1;
  let gaps = 0;

  for (const char of target)
  {
    const found = haystack.indexOf(char, index);
    if (found === -1)
    {
      return null;
    }
    if (previous !== -1)
    {
      gaps += found - previous - 1;
    }
    previous = found;
    index = found + 1;
  }
  return gaps;
}

/**
 * What an empty palette leads with.
 *
 * Alphabetical by group put "Branch / Checkout Branch…" first and everything anyone opens
 * the palette for below the fold, so the first screen of the app's list of everything it
 * can do read as an arbitrary slice of it. These are the operations of an ordinary day, in
 * the order a day tends to take them; past the last one the alphabet takes over again.
 */
const COMMON_COMMANDS = [
  'commit.open',
  'remote.pull',
  'remote.push',
  'branch.checkout',
  'branch.create',
  'stash.save',
  'view.refresh',
  'search.grep',
  'settings.open'
];

const matches = computed(() =>
{
  const commands = availableCommands(props.context).filter((c) => c.run);
  const scored: { command: CommandDef; score: number }[] = [];

  for (const command of commands)
  {
    const value = score(`${command.group} ${command.label}`, query.value);
    if (value !== null)
    {
      scored.push({ command, score: value });
    }
  }

  // Only with nothing typed. Once there is a query the score is the whole ranking: a
  // common command that matches worse than an uncommon one has no claim to be above it.
  if (!query.value)
  {
    return scored.sort((a, b) => rankOf(a.command.id) - rankOf(b.command.id)
      || a.command.label.localeCompare(b.command.label));
  }

  return scored.sort((a, b) => a.score - b.score || a.command.label.localeCompare(b.command.label));
});

/** Where a command sits in `COMMON_COMMANDS`, or past the end of it. */
function rankOf(id: string): number
{
  const index = COMMON_COMMANDS.indexOf(id);
  if (index === -1)
  {
    return COMMON_COMMANDS.length;
  }
  return index;
}

watch(query, () => (selected.value = 0));

watch(
  () => ui.paletteOpen,
  async (open) =>
  {
    if (!open)
    {
      return;
    }
    query.value = '';
    selected.value = 0;
    await nextTick();
    inputEl.value?.focus();
  },
  { immediate: true }
);

function move(delta: number): void
{
  const count = matches.value.length;
  if (!count)
  {
    return;
  }
  selected.value = (selected.value + delta + count) % count;
}

/**
 * Run a row: the one clicked, or the highlighted one for Enter.
 *
 * `index` is not optional decoration. Calling this with nothing runs whatever `selected`
 * points at, which relies on `@mousemove` having moved the highlight under the pointer:
 * true while the pointer is moving, false when it is not. The list re-filters on every
 * keystroke, so a pointer resting over row two while you type has row one highlighted
 * underneath it, and the click would run a command you never saw. Two commands sharing a
 * prefix, "Checkout Branch…" and "Checkout Branch Here", is when that costs something.
 */
async function accept(index: number = selected.value): Promise<void>
{
  const match = matches.value[index];
  if (!match)
  {
    return;
  }
  ui.closePalette();
  await runCommand(match.command.id, props.context);
}
</script>

<template>
  <div v-if="ui.paletteOpen" class="scrim" @mousedown.self="ui.closePalette()">
    <div class="palette" role="dialog" aria-label="Command palette">
      <input
        ref="inputEl"
        v-model="query"
        type="text"
        class="input"
        placeholder="Type a command…"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="accept()"
      />

      <ul v-if="matches.length" class="results">
        <li
          v-for="(match, index) in matches"
          :key="match.command.id"
          class="item"
          :class="{ selected: index === selected }"
          @mousemove="selected = index"
          @click="accept(index)"
        >
          <span class="group">{{ match.command.group }}</span>
          <span class="label">{{ match.command.label }}</span>
          <span v-if="match.command.keys?.length" class="keys">
            {{ formatAccelerator(match.command.keys[0]!) }}
          </span>
        </li>
      </ul>

      <p v-else class="none">No matching commands</p>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  z-index: 100;
}

.palette {
  width: min(560px, 90vw);
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.input {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
  padding: var(--space-3);
  font-size: var(--text-lg);
  background: transparent;
}

.results {
  list-style: none;
  margin: 0;
  padding: var(--space-1);
  max-height: 45vh;
  overflow-y: auto;
}

.item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
}

.item.selected {
  background: var(--accent);
  color: var(--fg-on-accent);
}

.group {
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  min-width: 70px;
  flex: none;
}

.item.selected .group,
.item.selected .keys {
  color: var(--fg-on-accent);
  opacity: 0.75;
}

.label {
  flex: 1;
}

.keys {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.none {
  padding: var(--space-4);
  text-align: center;
  color: var(--fg-subtle);
  font-size: var(--text-sm);
}
</style>
