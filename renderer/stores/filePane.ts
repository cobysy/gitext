/**
 * Wanted file path (both lists). Shared path lets you walk commits and watch
 * file change. Remembers across commits/lists.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useFilePaneStore = defineStore('filePane', () =>
{
  /** Last path person asked for. */
  const wantedPath = ref<string | null>(null);

  function want(path: string | null): void
  {
    wantedPath.value = path;
  }

  /** Drop it: different repository open. */
  function forget(): void
  {
    wantedPath.value = null;
  }

  return { wantedPath, want, forget };
});
