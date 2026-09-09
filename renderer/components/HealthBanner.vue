<script setup lang="ts">
/**
 * Health check banner: problems that break git surface here on first run, not on a
 * settings page nobody opens.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { HealthCheckItem } from '@shared/types.js';
import { api } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { runCommand } from '@renderer/commands/registry.js';
import type { CommandContext } from '@renderer/commands/registry.js';

const HEALTH_STATUS_OK = 'ok';
const HEALTH_STATUS_WARN = 'warn';
const HEALTH_STATUS_ERROR = 'error';

const props = defineProps<{ context: CommandContext }>();

const repoStore = useRepoStore();
const ui = useUiStore();
const items = ref<HealthCheckItem[]>([]);
const showDetail = ref(false);

/** Only problems are worth interrupting for; passing checks stay in Settings. */
const problems = computed(() => items.value.filter((i) => i.status !== HEALTH_STATUS_OK));
const worst = computed<'error' | 'warn' | null>(() =>
{
  if (problems.value.some((i) => i.status === HEALTH_STATUS_ERROR))
  {
    return HEALTH_STATUS_ERROR;
  }
  if (problems.value.length)
  {
    return HEALTH_STATUS_WARN;
  }
  else
  {
    return null;
  }
});

async function check(): Promise<void>
{
  items.value = await api['env:health'](repoStore.repo?.path ?? null);
}

onMounted(check);
// A repo-local user.email can fix a global one that is missing.
watch(() => repoStore.repo?.path, check);

/** Re-check on config changes, since the Fix button opens a config window.
    Without this, the banner would still show stale problems after fixing them. */
const stopListening = api.on('event:repoChanged', (change) =>
{
  if (change.facets.includes('config'))
  {
    void check();
  }
});
onUnmounted(stopListening);

async function fix(item: HealthCheckItem): Promise<void>
{
  if (item.fixCommand)
  {
    await runCommand(item.fixCommand, props.context);
  }
}
</script>

<template>
  <div v-if="worst && !ui.healthDismissed" class="banner" :class="worst" role="status" aria-live="polite">
    <div class="summary">
      <strong>
        {{ worst === HEALTH_STATUS_ERROR ? 'Git is not ready' : 'Check your git setup' }}
      </strong>
      <span class="detail">
        {{ problems.length }} {{ problems.length === 1 ? 'issue' : 'issues' }} found
      </span>
      <div class="spacer" />
      <button @click="showDetail = !showDetail">
        {{ showDetail ? 'Hide' : 'Details' }}
      </button>
      <button @click="ui.healthDismissed = true">Dismiss</button>
    </div>

    <ul v-if="showDetail" class="items">
      <li v-for="item in problems" :key="item.id" :class="item.status">
        <span class="label">{{ item.label }}</span>
        <span class="text">{{ item.detail }}</span>
        <button v-if="item.fixCommand" @click="fix(item)">Fix…</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.banner {
  flex: none;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
}

.banner.error {
  background: color-mix(in srgb, var(--danger) 12%, var(--bg));
}

.banner.warn {
  background: color-mix(in srgb, var(--warning) 14%, var(--bg));
}

.summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.detail {
  color: var(--fg-muted);
}

.items {
  list-style: none;
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
}

.items li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-top: 1px solid var(--border-subtle);
}

.label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  min-width: 90px;
  flex: none;
}

.text {
  flex: 1;
  color: var(--fg-muted);
}

li.error .label {
  color: var(--danger);
}

li.warn .label {
  color: var(--warning);
}
</style>
