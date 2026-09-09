// @vitest-environment happy-dom
/**
 * The confirmation, mounted.
 *
 * All wiring, and none of it reachable from a unit test: `ui.confirm()` hands back a
 * promise, the component renders from the store, and the answer travels back through
 * `answerConfirm` to resolve that promise. Half of what is asserted here is a keyboard
 * handler bound to the *window*, which only exists once something is mounted.
 *
 * The case worth the harness on its own is the timestamp guard. Running a command from the
 * palette with Enter and having it call `ui.confirm` puts a still-propagating Enter in
 * front of a listener that has just been added: answering the question in the same breath
 * as it was asked, too fast to see. `listeningSince` compares against the moment the event
 * was *created*, and nothing but a mounted component can be made to demonstrate that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';

const patched: Record<string, unknown>[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'settings:get': () => Promise.resolve({ suppressedConfirms: [] }),
    'settings:patch': (next: Record<string, unknown>) =>
    {
      patched.push(next);
      return Promise.resolve({ suppressedConfirms: [], ...next });
    },
    // `DialogFrame` is `in-page` here, so it reports nothing: present in case that changes.
    'dialog:fit': () => Promise.resolve()
  }
}));

class NoopResizeObserver
{
  observe(): void
  {}
  unobserve(): void
  {}
  disconnect(): void
  {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

const ConfirmDialog = (await import('@renderer/components/dialogs/ConfirmDialog.vue')).default;
const { useUiStore } = await import('@renderer/stores/ui.js');

/**
 * Take every mounted component down when its test ends.
 *
 * A component left mounted keeps whatever it bound to on mount: here a `keydown` listener
 * on the window, and it sits *earlier* in the listener list than the next test's, so the
 * older one handles the key first and the component under test never hears it.
 */
enableAutoUnmount(afterEach);

/** Ask, then draw the question: the order `DialogHost`'s `v-if` produces. */
async function ask(request: Parameters<ReturnType<typeof useUiStore>['confirm']>[0])
{
  const ui = useUiStore();
  const answer = ui.confirm(request);
  const dialog = mount(ConfirmDialog);
  await nextTick();
  return { answer, dialog };
}

const buttonNamed = (dialog: ReturnType<typeof mount>, label: string) =>
  dialog.findAll('button').find((b) => b.text() === label)!;

/** Stands in for "the promise never settled", which is what an ignored key must leave. */
const UNANSWERED = Symbol('unanswered');

/**
 * Let everything that was going to happen, happen.
 *
 * A `nextTick` is not enough to prove a *negative* here: `ui.confirm`'s promise settles a
 * few microtask hops after `answerConfirm` runs, so a race run too early reports "not
 * answered" for a question that was about to be. A macrotask drains the lot, which is what
 * makes "still pending" mean it.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ConfirmDialog', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    patched.length = 0;
  });

  it('draws the question it was asked', async () =>
  {
    const { dialog } = await ask({ title: 'Delete branch', message: 'Delete feature/x?' });

    expect(dialog.text()).toContain('Delete branch');
    expect(dialog.text()).toContain('Delete feature/x?');
  });

  it('sets the git it names in the code font', async () =>
  {
    // The question is where mistaking a branch for a word costs something, so the message
    // is written with backticks and rendered like a hint. The title stays plain.
    const { dialog } = await ask({
      title: 'Delete branch',
      message: 'Deleting `feature/x` runs `branch -D`.'
    });

    expect(dialog.findAll('code').map((el) => el.text())).toEqual(['feature/x', 'branch -D']);
    expect(dialog.text()).toContain('Deleting feature/x runs branch -D.');
  });

  it('resolves the promise with yes when the confirming button is pressed', async () =>
  {
    const { answer, dialog } = await ask({
      title: 'Delete',
      message: 'Sure?',
      confirmLabel: 'Delete it'
    });

    await buttonNamed(dialog, 'Delete it').trigger('click');

    await expect(answer).resolves.toBe(true);
  });

  it('resolves with no when cancelled', async () =>
  {
    const { answer, dialog } = await ask({ title: 'Delete', message: 'Sure?' });

    await buttonNamed(dialog, 'Cancel').trigger('click');

    await expect(answer).resolves.toBe(false);
  });

  it('labels the confirming button OK when the caller named nothing', async () =>
  {
    const { dialog } = await ask({ title: 'Go on', message: 'Sure?' });

    expect(buttonNamed(dialog, 'OK')).toBeDefined();
  });

  describe('the keyboard', () =>
  {
    it('confirms on Enter', async () =>
    {
      const { answer } = await ask({ title: 'Delete', message: 'Sure?' });

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      await expect(answer).resolves.toBe(true);
    });

    it('cancels on Escape', async () =>
    {
      const { answer } = await ask({ title: 'Delete', message: 'Sure?' });

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      await expect(answer).resolves.toBe(false);
    });

    /**
     * The Enter that ran the command must not also answer the question that command asked.
     * An event made before the listener started is that keypress: it is still propagating
     * when the dialog mounts.
     */
    it('ignores a keypress older than the dialog', async () =>
    {
      // Made before the listener exists, which is what the palette's own Enter is by the
      // time this dialog mounts. happy-dom stamps an event when it is constructed, on the
      // same clock `listeningSince` reads, so this is the real comparison.
      const stillPropagating = new KeyboardEvent('keydown', { key: 'Enter' });

      const { answer } = await ask({ title: 'Delete', message: 'Sure?' });
      window.dispatchEvent(stillPropagating);

      // Racing rather than reading a flag: an unanswered question leaves `answer` pending
      // forever, and a pending promise is exactly what a race against a settled one loses
      // to. `flush` first, so "pending" is a verdict rather than a head start.
      await flush();
      expect(await Promise.race([answer, Promise.resolve(UNANSWERED)])).toBe(UNANSWERED);
    });

    it('still answers a key pressed after it appeared', async () =>
    {
      const { answer } = await ask({ title: 'Delete', message: 'Sure?' });

      // Made now, so it is newer than the listener: the ordinary case.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      await expect(answer).resolves.toBe(true);
    });
  });

  describe('“don’t ask again”', () =>
  {
    it('is not offered for a question with no key to remember it under', async () =>
    {
      const { dialog } = await ask({ title: 'Delete', message: 'Sure?' });

      expect(dialog.find('input[type="checkbox"]').exists()).toBe(false);
    });

    it('records the answer when it is ticked and the answer is yes', async () =>
    {
      const { dialog } = await ask({
        title: 'Re-apply',
        message: 'Pop the stash?',
        rememberKey: 'stash.pop'
      });

      await dialog.find('input[type="checkbox"]').setValue(true);
      await buttonNamed(dialog, 'OK').trigger('click');
      await nextTick();

      expect(patched).toHaveLength(1);
      expect(JSON.stringify(patched[0])).toContain('stash.pop');
    });

    /** Suppressing "no" would record an answer that makes the action look broken. */
    it('records nothing when the answer is no', async () =>
    {
      const { dialog } = await ask({
        title: 'Re-apply',
        message: 'Pop the stash?',
        rememberKey: 'stash.pop'
      });

      await dialog.find('input[type="checkbox"]').setValue(true);
      await buttonNamed(dialog, 'Cancel').trigger('click');
      await nextTick();

      expect(patched).toHaveLength(0);
    });

    it('records nothing when it is offered but left unticked', async () =>
    {
      const { dialog } = await ask({
        title: 'Re-apply',
        message: 'Pop the stash?',
        rememberKey: 'stash.pop'
      });

      await buttonNamed(dialog, 'OK').trigger('click');
      await nextTick();

      expect(patched).toHaveLength(0);
    });
  });
});
