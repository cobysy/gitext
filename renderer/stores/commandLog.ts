/** Command log store: records on start and exit (second replaces first, visible while running). */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { GIT_KIND_READ, type GitCommandRecord } from '@shared/types.js';
import { api } from '@renderer/api.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

/** True when `r` should be hidden by the "failed only" toggle: it succeeded, or is still running. */
function hiddenByFailedOnly(r: GitCommandRecord, failedOnly: boolean): boolean
{
  return failedOnly && (r.exitCode === 0 || r.running);
}

/** True when `r` passes the command log's current filters. */
function passesLogFilters(r: GitCommandRecord, failedOnly: boolean, hideReads: boolean): boolean
{
  if (hiddenByFailedOnly(r, failedOnly))
  {
    return false;
  }
  if (hideReads && r.kind === GIT_KIND_READ)
  {
    return false;
  }
  return true;
}

/** True when `r` represents a command that exited with a non-zero status. */
function isFailedRun(r: GitCommandRecord): boolean
{
  return r.exitCode !== null && r.exitCode !== 0 && r.optional !== true;
}

export const useCommandLogStore = defineStore('commandLog', () =>
{
  const records = ref<GitCommandRecord[]>([]);
  /** Panel visibility: preference (stays closed if you closed it); filters below are session state. */
  const settings = useSettingsStore();
  const visible = computed(() => settings.settings.showCommandLog);
  const failedOnly = ref(false);
  /** Hide the background polling git does on its own, which is most of the volume. */
  const hideReads = ref(false);

  const filtered = computed(() =>
    records.value.filter((r) => passesLogFilters(r, failedOnly.value, hideReads.value))
  );

  const failureCount = computed(() => records.value.filter(isFailedRun).length);

  async function load(): Promise<void>
  {
    records.value = await api['log:list']();
  }

  function upsert(record: GitCommandRecord): void
  {
    const index = records.value.findIndex((r) => r.id === record.id);
    if (index === -1)
    {
      records.value.push(record);
    }
    else
    {
      records.value[index] = record;
    }
  }

  async function clear(): Promise<void>
  {
    await api['log:clear']();
    records.value = [];
  }

  function toggle(): void
  {
    void settings.patch({ showCommandLog: !visible.value });
  }

  return { records, visible, failedOnly, hideReads, filtered, failureCount, load, upsert, clear, toggle };
});
