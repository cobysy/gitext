// @vitest-environment happy-dom
/**
 * A dialog's initial focus: the first field, unless the dialog has already put the
 * keyboard somewhere itself. The commit screen puts it in the message, and the first
 * field in document order is a list's filter.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, onMounted, ref } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { useDialogKeyboard } from '@renderer/components/useDialogKeyboard.js';
import type { useUiStore } from '@renderer/stores/ui.js';

enableAutoUnmount(afterEach);

const ui = { confirmRequest: null } as unknown as ReturnType<typeof useUiStore>;

function harness(placesFocus: boolean)
{
  return defineComponent({
    setup()
    {
      const ready = ref(false);
      const chosen = ref<HTMLTextAreaElement | null>(null);
      useDialogKeyboard({ ui, ready, close: () => undefined });
      onMounted(() =>
      {
        if (placesFocus)
        {
          chosen.value?.focus();
        }
        ready.value = true;
      });
      return () =>
        h('div', { class: 'frame' }, [
          h('div', { class: 'body' }, [
            h('input', { class: 'filter' }),
            h('textarea', { class: 'message', ref: chosen })
          ])
        ]);
    }
  });
}

/** Past the first poll, which is where the host would have moved it. */
function afterPoll(): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, 80));
}

describe('useDialogKeyboard initial focus', () =>
{
  it('focuses the first field when the dialog chose nothing', async () =>
  {
    const wrapper = mount(harness(false), { attachTo: document.body });
    await afterPoll();
    expect(document.activeElement).toBe(wrapper.find('.filter').element);
  });

  it('leaves the keyboard where the dialog put it', async () =>
  {
    const wrapper = mount(harness(true), { attachTo: document.body });
    await afterPoll();
    expect(document.activeElement).toBe(wrapper.find('.message').element);
  });
});
