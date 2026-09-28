/**
 * A typed branch name, and the name that is actually used.
 *
 * The field is rewritten only when it is left, since rewriting on every keystroke fights
 * the caret. The preview, the check and the run read `name`, which is already tidied, so
 * pressing Enter from inside the field creates what the field would have become.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { normaliseBranchName } from '@renderer/model/branchName.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

export interface BranchNameField {
  /** What is in the field. */
  typed: Ref<string>;
  /** The name the dialog uses: trimmed, and tidied when the setting is on. */
  name: ComputedRef<string>;
  /** The field's hint, or none when nothing is tidied. */
  hint: ComputedRef<string | undefined>;
  /** Writes the tidied name back into the field: the field's `@blur`. */
  commit: () => void;
}

export function useBranchNameField(initial = ''): BranchNameField
{
  const settings = useSettingsStore();
  const typed = ref(initial);

  const name = computed(() =>
  {
    const trimmed = typed.value.trim();
    if (!settings.settings.normaliseBranchNames)
    {
      return trimmed;
    }
    return normaliseBranchName(trimmed, { token: settings.settings.normaliseBranchSymbol });
  });

  const hint = computed(() =>
  {
    if (settings.settings.normaliseBranchNames)
    {
      return `Spaces and characters git refuses become \`${settings.settings.normaliseBranchSymbol}\`.`;
    }
    return undefined;
  });

  function commit(): void
  {
    if (name.value !== typed.value)
    {
      typed.value = name.value;
    }
  }

  return { typed, name, hint, commit };
}
