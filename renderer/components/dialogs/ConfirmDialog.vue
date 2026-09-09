<script setup lang="ts">
/**
 * Yes/no question as a real dialog (not window.confirm). Rendered in asking window, not its own.
 */

import { onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import CodeText from '@renderer/components/ui/CodeText.vue';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import { KEY_ENTER, KEY_ESCAPE } from '@renderer/keys.js';


const ui = useUiStore();
const settings = useSettingsStore();

/** Ticked "don't ask again", for a question that offers it. */
const remember = ref(false);

/** The key to suppress this question under, or none: only on "yes", and only if asked to remember. */
function rememberKeyToSuppress(ok: boolean, remember: boolean, key: string | undefined): string | undefined
{
  if (ok && remember)
  {
    return key;
  }
  else
  {
    return undefined;
  }
}

async function answer(ok: boolean): Promise<void>
{
  const request = ui.confirmRequest;
  // Only on the way through, and only when the answer was yes: suppressing a question
  // records the answer it will give from now on, and "no" is not an answer worth
  // repeating silently: it would make the action look broken.
  const keyToSuppress = rememberKeyToSuppress(ok, remember.value, request?.rememberKey);
  if (keyToSuppress)
  {
    await settings.suppressConfirm(keyToSuppress);
  }
  ui.answerConfirm(ok);
}

/**
 * When this dialog's listener started caring about keys, on `event.timeStamp`'s clock.
 *
 * Guards against answering the question with the very keypress that *asked* it. Run a
 * command from the command palette with Enter, have it call `ui.confirm`, and the listener
 * added below would otherwise receive that same still-propagating Enter: confirming the
 * prompt in the same breath as it appeared, too fast to see.
 *
 * `timeStamp` rather than a `nextTick` or a `setTimeout(0)`: it compares against the moment
 * the event was *created*, so it is exact regardless of how many ticks the render took, and
 * a key pressed a millisecond after the dialog appears still works.
 */
const listeningSince = ref(0);

/**
 * Enter confirms, Escape cancels: bound on the window, not on a focused control.
 *
 * Nothing here is focused on purpose. Focusing the confirming button would draw a ring
 * around it, and this app does not ring its controls; the question is two sentences and
 * two buttons, and which one is the default is said by the button's colour. The binding
 * lives on the window so both keys work with the focus wherever it was: in the repo
 * window, where the grid or a list still holds it, as well as in a dialog window.
 */
function onKeydown(event: KeyboardEvent): void
{
  if (!ui.confirmRequest)
  {
    return;
  }
  if (event.timeStamp < listeningSince.value)
  {
    return;
  }
  switch (event.key)
  {
    case KEY_ENTER:
      event.preventDefault();
      void answer(true);
      break;
    case KEY_ESCAPE:
      event.preventDefault();
      void answer(false);
      break;
    default:
      break;
  }
}

onMounted(() =>
{
  listeningSince.value = performance.now();
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <DialogFrame
    v-if="ui.confirmRequest"
    in-page
    :title="ui.confirmRequest.title"
    @close="answer(false)"
  >
    <!-- The question names branches, paths and flags, so it is written with the same
         backticks a hint is: a ref left in the prose face is a word, and this is the
         window where mistaking one for the other costs something. The title stays plain:
         it is a window title. -->
    <p class="message"><CodeText :text="ui.confirmRequest.message" /></p>

    <label v-if="ui.confirmRequest.rememberKey" class="remember">
      <input v-model="remember" type="checkbox" />
      <span>Don't ask again</span>
    </label>

    <template #actions>
      <button @click="answer(false)">Cancel</button>
      <button
        :class="ui.confirmRequest.danger ? 'danger' : 'primary'"
        @click="answer(true)"
      >
        {{ ui.confirmRequest.confirmLabel ?? 'OK' }}
      </button>
    </template>
  </DialogFrame>
</template>

<style scoped>
.message {
  margin: 0;
  line-height: 1.5;
}

.remember {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
</style>
