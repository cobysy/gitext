// @vitest-environment happy-dom
/**
 * The status bar, mounted.
 *
 * What needs mounting is that its three statements about the repository are wired to
 * anything at all. They were `<span>`s: the most read line in the window, saying which
 * branch you are on and how far it is from its upstream, with nothing to click. A unit
 * test can check that `currentBranchMenu` names the right ids, and did; it cannot check
 * that the branch is a button, that pressing the arrow runs a push, or that the menu the
 * button opens is the one that was declared.
 *
 * The counts are deliberately asserted through the DOM the user sees rather than through
 * the store: a cell that renders but is not a control is exactly the defect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

/** Every command the bar asked to run, in order. */
const commandsRun: string[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (error: unknown) => String(error),
  api: { on: () => () => undefined }
}));

vi.mock('@renderer/commands/registry.js', async (importOriginal) =>
{
  const actual = await importOriginal<typeof import('@renderer/commands/registry.js')>();
  return {
    ...actual,
    runCommand: (id: string) =>
    {
      commandsRun.push(id);
      return Promise.resolve(true);
    }
  };
});

enableAutoUnmount(afterEach);

async function mountBar()
{
  const StatusBar = (await import('@renderer/components/StatusBar.vue')).default;
  const { useRepoStore } = await import('@renderer/stores/repo.js');
  // The menu is ids resolved against the registry, so an unbuilt one renders no rows at
  // all: which is what the row assertion below would otherwise be passing against.
  (await import('@renderer/commands/index.js')).registerCommands();

  const repo = useRepoStore();
  repo.repo = {
    path: '/tmp/demo',
    name: 'demo',
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567'
  } as never;
  repo.status = { ahead: 2, behind: 1, files: [{ path: 'a.ts' }, { path: 'b.ts' }] } as never;

  const wrapper = mount(StatusBar);
  await flushPromises();
  return { wrapper, repo };
}

describe('the status bar', () =>
{
  beforeEach(() =>
  {
    commandsRun.length = 0;
    setActivePinia(createPinia());
    // `DialogFrame` and the menu observe their own boxes; happy-dom has no observer.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class
    {
      observe(): void
      {
      }

      unobserve(): void
      {
      }

      disconnect(): void
      {
      }
    };
  });

  it('draws the branch as a control, not as a label', async () =>
  {
    const { wrapper } = await mountBar();
    const branch = wrapper.find('button.branch');
    expect(branch.exists()).toBe(true);
    expect(branch.text()).toBe('main');
  });

  it('opens the current branch menu from the branch name', async () =>
  {
    const { wrapper } = await mountBar();

    // The negative twin: nothing is open until the button is pressed, so the assertion
    // below cannot be passing because the selector matches nothing either way.
    expect(wrapper.find('.menu').exists()).toBe(false);

    await wrapper.find('button.branch').trigger('click');
    await flushPromises();

    const rows = wrapper.findAll('.menu .row').map((row) => row.text());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.includes('Checkout'))).toBe(true);
  });

  it('pushes and pulls from the ahead and behind counts', async () =>
  {
    const { wrapper } = await mountBar();
    const counts = wrapper.findAll('.tracking button');
    expect(counts).toHaveLength(2);
    expect(counts[0]!.text()).toContain('2');
    expect(counts[1]!.text()).toContain('1');

    await counts[0]!.trigger('click');
    await counts[1]!.trigger('click');
    await flushPromises();

    expect(commandsRun).toEqual(['remote.push', 'remote.pull']);
  });

  it('commits from the changed-file count', async () =>
  {
    const { wrapper } = await mountBar();
    const changes = wrapper.find('button.changes');
    expect(changes.text()).toContain('2 changed');

    await changes.trigger('click');
    await flushPromises();
    expect(commandsRun).toEqual(['commit.open']);
  });
});
