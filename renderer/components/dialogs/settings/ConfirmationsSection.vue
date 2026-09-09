<script setup lang="ts">
/**
 * Toggle suppressed confirmations back on. A "don't ask again" with no undo is a trap.
 * Questions are data-driven from `shared/confirmations.ts` so new ones appear here
 * automatically.
 */

import { computed } from 'vue';
import { CONFIRMATIONS } from '@shared/confirmations.js';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import { useSettingsStore } from '@renderer/stores/settings.js';

const store = useSettingsStore();

/** Built once at setup, not recreated per render. */
const toggles = CONFIRMATIONS.map((entry) => ({
  entry,
  enabled: computed({
    get: () => !store.confirmSuppressed(entry.key),
    set: (value: boolean) =>
    {
      if (value)
      {
        return store.unsuppressConfirm(entry.key);
      }
      else
      {
        return store.suppressConfirm(entry.key);
      }
    }
  })
}));
</script>

<template>
  <div>
    <p class="hint intro">
      Questions you ticked "don't ask again" on.
    </p>
    <div class="form">
      <FormCheck
        v-for="toggle in toggles"
        :key="toggle.entry.key"
        v-model="toggle.enabled.value"
        :label="toggle.entry.label"
        :hint="`toggle.entry.detail`"
      />
    </div>
  </div>
</template>

<style scoped>
.intro {
  margin-bottom: var(--space-3);
}
</style>
