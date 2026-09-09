<script setup lang="ts">
/**
 * Dialog window root. Reads `?name=`/`?payload=`, loads settings/theme, adopts the
 * repository. Deliberately doesn't call `useCommands()`: a dialog has no command
 * registry, only Escape (close) and Enter (primary action), both in
 * `useDialogKeyboard.ts`. Bootstrapping is `useDialogBootstrap.ts`'s job; this file
 * resolves which dialog and props the URL names, and composes the two.
 */

import { computed, shallowRef, type Component } from 'vue';
import { api } from '@renderer/api.js';
import type { DialogPayload } from '@shared/dialogs.js';
import { QUERY_PARAM_NAME, currentDialogName } from '@renderer/dialogs/current.js';
import { DIALOG_COMPONENTS, propsFor } from '@renderer/dialogs/routes.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import ConfirmDialog from '@renderer/components/dialogs/ConfirmDialog.vue';
import ToastStack from '@renderer/components/ui/ToastStack.vue';
import { useDialogBootstrap } from './useDialogBootstrap.js';
import { useDialogKeyboard } from './useDialogKeyboard.js';

const QUERY_PARAM_PAYLOAD = 'payload';

const settingsStore = useSettingsStore();
const repoStore = useRepoStore();
const objects = useRepoObjectsStore();
const ui = useUiStore();

const params = new URLSearchParams(window.location.search);
const rawName = params.get(QUERY_PARAM_NAME) ?? '';
const name = currentDialogName();

const payload: DialogPayload = (() =>
{
  try
  {
    return JSON.parse(params.get(QUERY_PARAM_PAYLOAD) ?? '{}') as DialogPayload;
  }
  catch
  {
    // A payload that will not parse is a bug in the opener, not a reason to show
    // nothing: the dialog opens with no operand and says so in its own form.
    return {};
  }
})();

/*
 * The form is fetched here, at setup, and not by rendering an async component.
 *
 * Every route in `routes.ts` is an import rather than a component, so this window loads
 * its own form and not all fifty. Started now, so the fetch runs beside the bootstrap
 * below rather than after the `ready` it is gated on: a dialog waits for its code and for
 * its settings, and there is no reason those two should queue.
 */
const component = shallowRef<Component | null>(null);
if (name)
{
  void DIALOG_COMPONENTS[name]().then((module) =>
  {
    component.value = module.default;
  });
}
const componentProps = computed(() =>
{
  if (name)
  {
    return propsFor(name, payload);
  }
  else
  {
    return {};
  }
});

function close(): void
{
  void api['dialog:close']();
}

const { ready } = useDialogBootstrap({ name, payload, settings: settingsStore, repo: repoStore, objects });
useDialogKeyboard({ ui, ready, close });
</script>

<template>
  <div class="host">
    <component
      :is="component"
      v-if="component && ready"
      v-bind="componentProps"
      @close="close"
    />
    <!-- A name no build has a component for: better a window that says so than a blank
         one nobody can explain. Keyed on the *name*, not on the component, which is null
         for a moment in the ordinary case too while its form is being fetched. -->
    <p v-else-if="!name" class="unknown">Unknown dialog: {{ rawName || '(none)' }}</p>

    <!-- Driven by a promise rather than by a route, so a dialog can ask its own
         questions, "re-apply the stash?", without a second window. -->
    <ConfirmDialog v-if="ui.confirmRequest" />
    <ToastStack />
  </div>
</template>

<style scoped>
.host {
  height: 100%;
  min-height: 0;
}

.unknown {
  padding: var(--space-4);
  color: var(--danger);
}
</style>
