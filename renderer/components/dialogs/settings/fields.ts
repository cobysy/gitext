/**
 * Bridge persisted settings to Form* controls (one place, not 40 :value/@change pairs).
 * Settings store fields become WritableComputedRef v-models.
 */

import { computed, type WritableComputedRef } from 'vue';
import type { Settings } from '@shared/types.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

/** A boolean setting, as a checkbox's `v-model`. */
export function flag(key: keyof Settings): WritableComputedRef<boolean>
{
  const store = useSettingsStore();
  return computed({
    get: () => Boolean(store.settings[key]),
    set: (value) => void store.patch({ [key]: value } as Partial<Settings>)
  });
}

/** A one-of-several setting, as a select's `v-model`. */
export function choice(key: keyof Settings): WritableComputedRef<string>
{
  const store = useSettingsStore();
  return computed({
    get: () => String(store.settings[key] ?? ''),
    set: (value) => void store.patch({ [key]: value } as Partial<Settings>)
  });
}

/** A numeric setting. `clamp` keeps a typed-in value inside what the field means. */
export function number(
  key: keyof Settings,
  clamp: (value: number) => number = (value) => value
): WritableComputedRef<number | null>
{
  const store = useSettingsStore();
  return computed({
    get: () => (store.settings[key] as number | null) ?? null,
    set: (value) =>
    {
      let clamped: number | null;
      if (value === null)
      {
        clamped = null;
      }
      else
      {
        clamped = clamp(value);
      }
      void store.patch({ [key]: clamped } as Partial<Settings>);
    }
  });
}
