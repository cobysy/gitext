// @vitest-environment happy-dom
/**
 * The commit screen's own keyboard, mounted.
 *
 * A composable rather than a component, but it binds to the *window* on mount and unbinds
 * on unmount, so there is nothing to test without mounting something. The host below stands
 * in for `CommitScreen.vue`: the four panes it draws, by the class names `focusPane` looks
 * them up with, and nothing else.
 *
 * The rule worth the harness is Escape, which three things want. A confirmation owns it and
 * must keep it: closing the whole screen out from under a question would answer it by
 * accident. The screen's own dropdown owns it next. Only then does it close the screen. And
 * because this screen is a dialog window, `useDialogKeyboard` has a generic Escape handler
 * over the same window, so "this one acted" has to be said with
 * `stopImmediatePropagation`, which is only observable from a second listener.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'git:readMessageFile': () => Promise.resolve('')
  }
}));

const { useScreenKeyboard } = await import('@renderer/components/commit/useScreenKeyboard.js');
const { useStagingStore, STAGING_SIDE_STAGED, STAGING_SIDE_UNSTAGED } = await import(
  '@renderer/stores/staging.js'
);
const { useUiStore } = await import('@renderer/stores/ui.js');

interface Harness {
  closed: number;
  menuClosed: number;
  menuOpen: boolean;
  focused: string[];
}

/**
 * A stand-in for the commit screen: the four panes, by the classes `focusPane` uses.
 *
 * Each focusable element records that it was focused, because happy-dom's `document
 * .activeElement` is not what the composable manipulates: it calls `focus()` on whatever
 * it found, and what is being tested is *which element it found*.
 */
function mountScreen(harness: Harness)
{
  const messageBox: Ref<{ focus: () => void } | null> = ref({
    focus: () => harness.focused.push('message')
  });

  const Host = defineComponent({
    setup()
    {
      const screen = ref<HTMLElement | null>(null);
      const { focusPane } = useScreenKeyboard({
        screen,
        messageBox,
        menuOpen: () => harness.menuOpen,
        closeMenu: () =>
        {
          harness.menuClosed += 1;
          harness.menuOpen = false;
        },
        onClose: () =>
        {
          harness.closed += 1;
        }
      });
      return { screen, focusPane };
    },
    render()
    {
      const pane = (cls: string, inner: string) =>
        h('div', { class: cls }, [h('div', { class: inner, tabindex: '0' })]);
      return h('div', { ref: 'screen' }, [
        pane('unstaged', 'rows'),
        pane('staged', 'rows'),
        pane('staging-diff', 'hunks')
      ]);
    }
  });

  return mount(Host, { attachTo: document.body });
}

/**
 * Take every mounted component down when its test ends.
 *
 * A component left mounted keeps whatever it bound to on mount: here a `keydown` listener
 * on the window, and it sits *earlier* in the listener list than the next test's, so the
 * older one handles the key first and the component under test never hears it.
 */
enableAutoUnmount(afterEach);

function harnessOf(): Harness
{
  return { closed: 0, menuClosed: 0, menuOpen: false, focused: [] };
}

/** Record which pane element `focusPane` reached for, since focus itself is not the rule. */
function traceFocus(wrapper: ReturnType<typeof mountScreen>, harness: Harness): void
{
  for (const [selector, name] of [
    ['.unstaged .rows', 'unstaged'],
    ['.staged .rows', 'staged'],
    ['.staging-diff .hunks', 'diff']
  ] as const)
  {
    const el = wrapper.element.querySelector(selector) as HTMLElement | null;
    if (!el)
    {
      throw new Error(`the stand-in screen is missing ${selector}`);
    }
    el.focus = () => harness.focused.push(name);
  }
}

const press = (key: string, init: KeyboardEventInit = {}): void =>
{
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
};

/** Listeners a test added, torn down with the screens that were mounted beside them. */
const listeners: (() => void)[] = [];

/**
 * Stand in for `useDialogKeyboard`: a window listener added *after* the screen's, so it is
 * behind it in the list and only hears what the screen lets through.
 *
 * Returns how many times it has fired, read at the end rather than captured, so nothing
 * left over from an earlier test can be mistaken for this one's.
 */
function listenBehind(): () => number
{
  let heard = 0;
  const onKey = (): void =>
  {
    heard += 1;
  };
  window.addEventListener('keydown', onKey);
  listeners.push(() => window.removeEventListener('keydown', onKey));
  return () => heard;
}

describe('the commit screen’s keyboard', () =>
{
  let harness: Harness;

  beforeEach(() =>
  {
    setActivePinia(createPinia());
    harness = harnessOf();
  });

  afterEach(() =>
  {
    for (const off of listeners.splice(0))
    {
      off();
    }
  });

  it('focuses the message box as soon as the screen opens', () =>
  {
    mountScreen(harness);

    expect(harness.focused).toEqual(['message']);
  });

  describe('Escape', () =>
  {
    it('closes the screen', () =>
    {
      mountScreen(harness);

      press('Escape');

      expect(harness.closed).toBe(1);
    });

    it('closes the screen’s own dropdown first, and leaves the screen open', () =>
    {
      harness.menuOpen = true;
      mountScreen(harness);

      press('Escape');

      expect(harness.menuClosed).toBe(1);
      expect(harness.closed).toBe(0);
    });

    /**
     * A confirmation owns Escape. Closing the screen out from under an unanswered question
     * would answer it by accident.
     */
    it('does nothing while a confirmation is unanswered', () =>
    {
      mountScreen(harness);
      void useUiStore().confirm({ title: 'Discard', message: 'Sure?' });

      press('Escape');

      expect(harness.closed).toBe(0);
      expect(harness.menuClosed).toBe(0);
    });

    /**
     * `useDialogKeyboard` binds a generic Escape over the same window and is what actually
     * answers a confirmation. Swallowing the event here would leave the question unanswered
     * *and* the screen open: so the event has to reach the listener behind this one.
     */
    it('lets the event through to the window’s other handler while a confirmation is up', () =>
    {
      mountScreen(harness);
      void useUiStore().confirm({ title: 'Discard', message: 'Sure?' });
      const reachedBehind = listenBehind();

      press('Escape');

      expect(reachedBehind()).toBe(1);
    });

    /** And when this handler *is* the one acting, it says so, or both handlers fire. */
    it('stops the event reaching that handler when it closes the screen itself', () =>
    {
      mountScreen(harness);
      const reachedBehind = listenBehind();

      press('Escape');

      expect(harness.closed).toBe(1);
      expect(reachedBehind()).toBe(0);
    });
  });

  describe('the four panes, by number', () =>
  {
    it('moves the keyboard to each of them', () =>
    {
      const wrapper = mountScreen(harness);
      traceFocus(wrapper, harness);
      harness.focused.length = 0;

      press('1', { metaKey: true });
      press('2', { metaKey: true });
      press('3', { metaKey: true });
      press('4', { metaKey: true });

      expect(harness.focused).toEqual(['unstaged', 'staged', 'diff', 'message']);
    });

    /**
     * A list also has to *be* the selected side, or the arrow keys it was just given would
     * move the other list's selection.
     */
    it('makes the list it focused the selected side', () =>
    {
      const staging = useStagingStore();
      mountScreen(harness);

      press('2', { metaKey: true });
      expect(staging.side).toBe(STAGING_SIDE_STAGED);

      press('1', { metaKey: true });
      expect(staging.side).toBe(STAGING_SIDE_UNSTAGED);
    });

    it('takes Control as well as Command', () =>
    {
      const wrapper = mountScreen(harness);
      traceFocus(wrapper, harness);
      harness.focused.length = 0;

      press('3', { ctrlKey: true });

      expect(harness.focused).toEqual(['diff']);
    });

    /** The modifier is Cmd/Ctrl *alone*: `Mod+Shift+1` belongs to something else. */
    it('ignores the number when Shift or Alt is held too', () =>
    {
      const wrapper = mountScreen(harness);
      traceFocus(wrapper, harness);
      harness.focused.length = 0;

      press('1', { metaKey: true, shiftKey: true });
      press('1', { metaKey: true, altKey: true });

      expect(harness.focused).toEqual([]);
    });

    it('ignores a bare number, which is someone typing', () =>
    {
      const wrapper = mountScreen(harness);
      traceFocus(wrapper, harness);
      harness.focused.length = 0;

      press('1');

      expect(harness.focused).toEqual([]);
    });
  });

  describe('committing', () =>
  {
    it('commits on Cmd/Ctrl+Enter', async () =>
    {
      const staging = useStagingStore();
      const commit = vi.spyOn(staging, 'commit').mockResolvedValue(true);
      mountScreen(harness);

      press('Enter', { metaKey: true });
      await flushPromises();

      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('does not commit on Enter alone, which is a newline in the message', async () =>
    {
      const staging = useStagingStore();
      const commit = vi.spyOn(staging, 'commit').mockResolvedValue(true);
      mountScreen(harness);

      press('Enter');
      await flushPromises();

      expect(commit).not.toHaveBeenCalled();
    });
  });

  it('stops listening once the screen is gone', () =>
  {
    const wrapper = mountScreen(harness);
    wrapper.unmount();

    press('Escape');

    expect(harness.closed).toBe(0);
  });
});
