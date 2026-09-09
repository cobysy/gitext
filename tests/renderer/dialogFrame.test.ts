// @vitest-environment happy-dom
/**
 * `DialogFrame`'s half of the fit protocol, mounted.
 *
 * A dialog window is created hidden and shown by `main/dialogs/fit.ts` when its renderer
 * reports a height. That makes reporting a *liveness* signal as well as a measurement:
 * a frame that stays silent leaves its window off screen until `fit.ts`'s timeout gives up,
 * so the dialog appears a second and a half after the click. Which of the three shapes
 * reports, and what a fixed-height one says instead of a number, is the rule here.
 *
 * **What this environment can and cannot see.** happy-dom does no layout, so every
 * `offsetHeight` is 0 and the *value* a measuring frame reports is not meaningful here:
 * `e2e/dialogs.spec.ts` is what checks real numbers, by opening every window and measuring it.
 * What is checked here is the contract: who reports, how often, and that the fixed-height
 * sentinel is a deliberate 0 rather than a frame that failed to measure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const fitted: number[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'dialog:fit': (height: number) =>
    {
      fitted.push(height);
      return Promise.resolve();
    },
    'dialog:close': () => Promise.resolve()
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

const DialogFrame = (await import('@renderer/components/ui/DialogFrame.vue')).default;

function open(props: Record<string, unknown>)
{
  return mount(DialogFrame, {
    props: { title: 'A dialog', ...props },
    slots: { default: '<p>the form</p>' }
  });
}

/**
 * Take every mounted component down when its test ends.
 *
 * A component left mounted keeps whatever it bound to on mount: a window listener, an
 * observer, a watcher, a request still in flight, and goes on doing it against a store
 * from a pinia the next test has already replaced. That is how an error arrives with no
 * test attached to it, and how a keypress gets handled by a screen nobody is looking at.
 */
enableAutoUnmount(afterEach);

describe('DialogFrame reporting its height', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    fitted.length = 0;
  });

  it('reports once for an ordinary form', async () =>
  {
    open({});
    await flushPromises();

    expect(fitted).toHaveLength(1);
  });

  /**
   * The sentinel. A fixed-height window has no measurement worth resizing to: a pane that
   * is a paragraph for one row and a form for the next has none, but it must still say it
   * has drawn itself, or `fit.ts` keeps it hidden until it times out.
   */
  it('reports exactly zero for a fixed-height window', async () =>
  {
    open({ fixedHeight: true });
    await flushPromises();

    expect(fitted).toEqual([0]);
  });

  /**
   * An in-page frame is `ConfirmDialog`, not a window, nothing to resize. Reporting from
   * one would resize whichever window it happens to be drawn in, to the height of a
   * question rendered inside it.
   */
  it('reports nothing at all in-page', async () =>
  {
    open({ inPage: true });
    await flushPromises();

    expect(fitted).toEqual([]);
  });

  it('draws the title it was given, and closes when asked', async () =>
  {
    const frame = open({});
    await flushPromises();

    expect(frame.text()).toContain('A dialog');
    expect(frame.text()).toContain('the form');

    await frame.find('button').trigger('click');
    expect(frame.emitted('close')).toBeTruthy();
  });
});
