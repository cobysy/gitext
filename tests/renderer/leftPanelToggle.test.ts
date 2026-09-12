// @vitest-environment happy-dom
/** The left panel's collapse control, mounted in both places it is drawn. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

/** Every command a button asked to run, in order. */
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

const COMMAND_ID = 'view.toggleLeftPanel';

/** Register first, or every assertion passes vacuously. */
async function registry()
{
  const module = await import('@renderer/commands/registry.js');
  (await import('@renderer/commands/index.js')).registerCommands();
  return module;
}

/** A repository has to be open: the command's `when` is `hasRepo`. */
async function openRepo(showLeftPanel: boolean)
{
  const { useRepoStore } = await import('@renderer/stores/repo.js');
  const { useSettingsStore } = await import('@renderer/stores/settings.js');

  const repo = useRepoStore();
  repo.repo = {
    path: '/tmp/demo',
    name: 'demo',
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567'
  } as never;

  const settings = useSettingsStore();
  settings.settings.showLeftPanel = showLeftPanel;
  return settings;
}

/** Read from where the button reads: the platform's symbols are not pinned here. */
async function expectedTitle(label: string): Promise<string>
{
  const { getCommand } = await registry();
  const { formatAccelerator } = await import('@renderer/keys.js');
  const key = getCommand(COMMAND_ID)?.keys?.[0];
  expect(key).toBeTruthy();
  return `${label} (${formatAccelerator(key!)})`;
}

describe('the left panel toggle', () =>
{
  beforeEach(() =>
  {
    commandsRun.length = 0;
    setActivePinia(createPinia());
    // The panel's virtualizer observes its scroller; happy-dom has no observer.
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

  it('offers the panel back from the rail, naming the key that does it', async () =>
  {
    await registry();
    await openRepo(false);
    const LeftPanelRail =
      (await import('@renderer/components/leftpanel/LeftPanelRail.vue')).default;

    const wrapper = mount(LeftPanelRail);
    await flushPromises();

    const button = wrapper.find('button.toggle');
    expect(button.attributes('aria-label')).toBe('Show the left panel');
    expect(button.attributes('title')).toBeUndefined();
    expect(button.find('.flyout').text()).toBe(await expectedTitle('Show the left panel'));

    await button.trigger('click');
    await flushPromises();
    expect(commandsRun).toEqual([COMMAND_ID]);
  });

  it('takes the key from the command rather than from a typed string', async () =>
  {
    const { getCommand } = await registry();
    await openRepo(false);
    const LeftPanelRail =
      (await import('@renderer/components/leftpanel/LeftPanelRail.vue')).default;

    // Asserting the current key cannot tell a button that asked from one with `⌘B` typed in.
    const { formatAccelerator } = await import('@renderer/keys.js');
    const command = getCommand(COMMAND_ID)!;
    const original = command.keys;
    command.keys = ['Mod+Alt+K'];
    try
    {
      const wrapper = mount(LeftPanelRail);
      await flushPromises();
      const moved = `Show the left panel (${formatAccelerator('Mod+Alt+K')})`;
      expect(wrapper.find('button.toggle .flyout').text()).toBe(moved);
    }
    finally
    {
      command.keys = original;
    }
  });

  it('turns around when the panel comes back', async () =>
  {
    await registry();
    const settings = await openRepo(false);
    const LeftPanelRail =
      (await import('@renderer/components/leftpanel/LeftPanelRail.vue')).default;

    const wrapper = mount(LeftPanelRail);
    await flushPromises();
    expect(wrapper.find('button.toggle').classes()).not.toContain('back');

    settings.settings.showLeftPanel = true;
    await flushPromises();

    const button = wrapper.find('button.toggle');
    expect(button.attributes('aria-label')).toBe('Hide the left panel');
    expect(button.classes()).toContain('back');
  });

  it('offers every section the panel has, in the order the panel has them', async () =>
  {
    await registry();
    await openRepo(false);
    const { useRepoObjectsStore } = await import('@renderer/stores/repoObjects.js');
    const { SECTION_LABELS } = await import('@renderer/panel.js');
    const LeftPanelRail =
      (await import('@renderer/components/leftpanel/LeftPanelRail.vue')).default;

    const objects = useRepoObjectsStore();
    const wrapper = mount(LeftPanelRail);
    await flushPromises();

    // The store's order: a rail ordered differently from the panel is two answers.
    expect(wrapper.findAll('button.section').map((b) => b.find('.flyout').text())).toEqual(
      objects.sections.map((id) => SECTION_LABELS[id])
    );
  });

  it('opens the panel at the section that was clicked', async () =>
  {
    await registry();
    await openRepo(false);
    const { useRepoObjectsStore } = await import('@renderer/stores/repoObjects.js');
    const { sectionNodeId } = await import('@renderer/panel.js');
    const LeftPanelRail =
      (await import('@renderer/components/leftpanel/LeftPanelRail.vue')).default;

    const objects = useRepoObjectsStore();
    const stashes = sectionNodeId('stashes');
    expect(objects.isExpanded(stashes)).toBe(false);

    const wrapper = mount(LeftPanelRail);
    await flushPromises();
    await wrapper.find('button[aria-label="Show the left panel at Stashes"]').trigger('click');
    await flushPromises();

    expect(objects.isExpanded(stashes), 'the section was not opened').toBe(true);
    expect(objects.selectedId, 'the section was not selected').toBe(stashes);
    expect(commandsRun, 'the panel was not shown').toEqual([COMMAND_ID]);
  });

  it('hides the panel from the panel\'s own filter strip', async () =>
  {
    await registry();
    await openRepo(true);
    const LeftPanel = (await import('@renderer/components/leftpanel/LeftPanel.vue')).default;

    const wrapper = mount(LeftPanel);
    await flushPromises();

    const button = wrapper.find('.filter button[aria-label="Hide the left panel"]');
    expect(button.exists()).toBe(true);

    await button.trigger('click');
    await flushPromises();
    expect(commandsRun).toEqual([COMMAND_ID]);
  });
});
