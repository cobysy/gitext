// @vitest-environment happy-dom
/**
 * The context menu's keyboard, mounted.
 *
 * Every surface in the app resolves its rows through `menus/resolve.ts` and hands them to
 * this one component, so what the arrow keys do here is what they do everywhere, and it is
 * a rule about *rows on screen* rather than about the array: separators and disabled rows
 * are skipped, and the highlight wraps past both ends.
 *
 * Placement is deliberately not tested. It reads `getBoundingClientRect`, and happy-dom does
 * no layout, so every number would be zero and every assertion vacuous; a menu drawn off the
 * edge of the screen is something to look at, not to assert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { ResolvedItem } from '@renderer/menus/resolve.js';

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {}
}));

const ContextMenu = (await import('@renderer/components/ui/ContextMenu.vue')).default;

const command = (id: string, over: Partial<ResolvedItem> = {}): ResolvedItem =>
  ({ kind: 'command', id, label: id, enabled: true, ...over }) as ResolvedItem;

const separator: ResolvedItem = { kind: 'separator' };

function open(items: ResolvedItem[])
{
  return mount(ContextMenu, { props: { items }, attachTo: document.body });
}

/**
 * The menu binds `keydown` on its own panel, not on the window: it is `tabindex="-1"` and
 * takes focus when it opens: so a key has to be sent to the panel to be heard at all.
 */
const press = async (menu: ReturnType<typeof open>, key: string): Promise<void> =>
{
  await menu.find('.menu').trigger('keydown', { key });
};

/** Which row the highlight is on, read off the DOM rather than out of the component. */
function highlighted(menu: ReturnType<typeof open>): string | null
{
  const row = menu.element.querySelector('.row.active');
  return row?.textContent?.trim() ?? null;
}

enableAutoUnmount(afterEach);

describe('ContextMenu keyboard navigation', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
  });

  it('starts with nothing highlighted', () =>
  {
    expect(highlighted(open([command('a'), command('b')]))).toBeNull();
  });

  it('takes Down to the first row and Up to the last', async () =>
  {
    const menu = open([command('a'), command('b'), command('c')]);

    await press(menu, 'ArrowDown');
    await menu.vm.$nextTick();
    expect(highlighted(menu)).toBe('a');

    const other = open([command('a'), command('b'), command('c')]);
    await press(other, 'ArrowUp');
    await other.vm.$nextTick();
    expect(highlighted(other)).toBe('c');
  });

  it('wraps past the end and back round', async () =>
  {
    const menu = open([command('a'), command('b')]);

    await press(menu, 'ArrowDown');
    await press(menu, 'ArrowDown');
    await press(menu, 'ArrowDown');
    await menu.vm.$nextTick();

    expect(highlighted(menu)).toBe('a');
  });

  /** A separator is not a row anybody can be on. */
  it('steps over a separator', async () =>
  {
    const menu = open([command('a'), separator, command('b')]);

    await press(menu, 'ArrowDown');
    await press(menu, 'ArrowDown');
    await menu.vm.$nextTick();

    expect(highlighted(menu)).toBe('b');
  });

  /**
   * A greyed row says "not now" and stays visible for that reason, but the keyboard has
   * no business landing on something that cannot be pressed.
   */
  it('steps over a disabled row', async () =>
  {
    const menu = open([command('a'), command('b', { enabled: false }), command('c')]);

    await press(menu, 'ArrowDown');
    await press(menu, 'ArrowDown');
    await menu.vm.$nextTick();

    expect(highlighted(menu)).toBe('c');
  });

  it('takes Home to the first and End to the last', async () =>
  {
    const menu = open([command('a'), command('b'), command('c')]);

    await press(menu, 'End');
    await menu.vm.$nextTick();
    expect(highlighted(menu)).toBe('c');

    await press(menu, 'Home');
    await menu.vm.$nextTick();
    expect(highlighted(menu)).toBe('a');
  });

  describe('choosing a row', () =>
  {
    it('runs the highlighted row on Enter, with the operand it named', async () =>
    {
      const menu = open([command('a'), command('branch.checkout', { options: 'feature/x' })]);

      await press(menu, 'ArrowDown');
      await press(menu, 'ArrowDown');
      await menu.vm.$nextTick();
      await press(menu, 'Enter');
      await menu.vm.$nextTick();

      expect(menu.emitted('run')).toEqual([['branch.checkout', 'feature/x']]);
    });

    it('runs it on Space as well', async () =>
    {
      const menu = open([command('a')]);

      await press(menu, 'ArrowDown');
      await menu.vm.$nextTick();
      await press(menu, ' ');
      await menu.vm.$nextTick();

      expect(menu.emitted('run')?.[0]?.[0]).toBe('a');
    });

    it('runs nothing when nothing is highlighted', async () =>
    {
      const menu = open([command('a')]);

      await press(menu, 'Enter');
      await menu.vm.$nextTick();

      expect(menu.emitted('run')).toBeUndefined();
    });

    it('runs the row that was clicked', async () =>
    {
      const menu = open([command('a'), command('b')]);

      await menu.findAll('.row')[1]!.trigger('click');

      expect(menu.emitted('run')?.[0]?.[0]).toBe('b');
    });

    it('runs nothing when a disabled row is clicked', async () =>
    {
      const menu = open([command('a', { enabled: false })]);

      await menu.find('.row').trigger('click');

      expect(menu.emitted('run')).toBeUndefined();
    });
  });

  describe('closing', () =>
  {
    it('closes on Escape', async () =>
    {
      const menu = open([command('a')]);

      await press(menu, 'Escape');
      await menu.vm.$nextTick();

      expect(menu.emitted('close')).toBeTruthy();
    });

    /**
     * Left out of a nested panel is the parent's business: it closes the child and takes
     * the highlight back, rather than the child closing the whole stack.
     */
    it('asks its parent to take it back on Left, when nested', async () =>
    {
      const menu = mount(ContextMenu, {
        props: { items: [command('a')], nested: true },
        attachTo: document.body
      });

      await press(menu, 'ArrowLeft');
      await menu.vm.$nextTick();

      expect(menu.emitted('back')).toBeTruthy();
      expect(menu.emitted('close')).toBeFalsy();
    });
  });
});
