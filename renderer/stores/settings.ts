/**
 * App preferences from `config.json`. Patch writes through `settings:patch` channel (main process is source of truth).
 * Git config is separate (read/written directly via `git config`).
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { normalizeSuppressions } from '@shared/confirmations.js';
import {
  DEFAULT_SETTINGS,
  FILES_PANE_MODE_TREE,
  THEME_DARK,
  THEME_LIGHT,
  THEME_SYSTEM,
  type Settings,
  type ThemePreference
} from '@shared/types.js';
import { api } from '@renderer/api.js';

export { FILES_PANE_MODE_TREE, THEME_DARK, THEME_LIGHT, THEME_SYSTEM };

// `settings.filePaneView`: what the second column beside it shows.
export const FILE_PANE_VIEW_FILE = 'file';
// `settings.branchScope`: how much of the history the grid loads.
export const BRANCH_SCOPE_CURRENT = 'current';
export const BRANCH_SCOPE_FILTERED = 'filtered';

/**
 * Collapse theme preference to scheme (light/dark). Resolves 'system' once against OS preference.
 */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark'
{
  if (preference === THEME_SYSTEM)
  {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches)
    {
      return THEME_DARK;
    }
    else
    {
      return THEME_LIGHT;
    }
  }
  else
  {
    return preference;
  }
}

export const useSettingsStore = defineStore('settings', () =>
{
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  // Resolved scheme (light or dark).
  const effectiveTheme = ref<'light' | 'dark'>(THEME_LIGHT);

  async function load(): Promise<void>
  {
    settings.value = await api['settings:get']();
  }

  async function patch(next: Partial<Settings>): Promise<void>
  {
    settings.value = await api['settings:patch'](next);
    if (next.theme !== undefined)
    {
      applyTheme(resolveTheme(settings.value.theme));
    }
  }

  /**
   * Adopt settings written elsewhere: the `event:settings` broadcast.
   *
   * Assignment only: this is the value the main process already holds, so writing it
   * back would be a round trip to say what was just said. The theme is not applied from
   * here either; `event:theme` carries the resolved scheme and arrives on its own.
   */
  function apply(next: Settings): void
  {
    settings.value = next;
  }

  function applyTheme(theme: 'light' | 'dark'): void
  {
    effectiveTheme.value = theme;
    document.documentElement.dataset.theme = theme;
  }

  /** The suppressed questions, reconciled: see `shared/confirmations.ts`. */
  const suppressions = computed(() => normalizeSuppressions(settings.value.confirmSuppressions));

  function confirmSuppressed(key: string): boolean
  {
    return suppressions.value[key] === true;
  }

  /** Record "don't ask again" for one question. */
  async function suppressConfirm(key: string): Promise<void>
  {
    await patch({ confirmSuppressions: { ...suppressions.value, [key]: true } });
  }

  /** Ask this one again: the way back out, which Settings is the surface for. */
  async function unsuppressConfirm(key: string): Promise<void>
  {
    const next = { ...suppressions.value };
    delete next[key];
    await patch({ confirmSuppressions: next });
  }

  return {
    settings,
    effectiveTheme,
    suppressions,
    load,
    patch,
    apply,
    applyTheme,
    confirmSuppressed,
    suppressConfirm,
    unsuppressConfirm
  };
});
