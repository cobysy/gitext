// @vitest-environment happy-dom
/**
 * The git-setup banner, mounted.
 *
 * The rule that needs mounting is the one about *staying* right: every check here but the
 * git binary itself is a config read, and the Fix button sends you to a window that writes
 * one: so a banner that only asked once would go on saying `user.name` is unset after you
 * had just set it, from a dialog it opened. It re-checks on a `config` change and on
 * nothing else, which is a subscription with a filter in it rather than a value anything
 * can compute.
 *
 * The rest is what a banner is: only problems, the worse of two statuses, and a dismissal
 * that sticks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { RepoFacet } from '@shared/invalidation.js';
import type { HealthCheckItem } from '@shared/types.js';

/** What `env:health` answers, and how many times it was asked. */
let health: HealthCheckItem[] = [];
let checks = 0;

/** The `event:repoChanged` subscribers the banner registered, so a test can fire one. */
const subscribers: ((change: { path: string; facets: RepoFacet[] }) => void)[] = [];

const commandsRun: string[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'env:health': () =>
    {
      checks += 1;
      return Promise.resolve(health);
    },
    on: (channel: string, listener: (change: { path: string; facets: RepoFacet[] }) => void) =>
    {
      if (channel === 'event:repoChanged')
      {
        subscribers.push(listener);
      }
      return () =>
      {
        const at = subscribers.indexOf(listener);
        if (at >= 0)
        {
          subscribers.splice(at, 1);
        }
      };
    }
  }
}));

vi.mock('@renderer/commands/registry.js', () => ({
  runCommand: (id: string) =>
  {
    commandsRun.push(id);
    return Promise.resolve();
  }
}));

const HealthBanner = (await import('@renderer/components/HealthBanner.vue')).default;
const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useUiStore } = await import('@renderer/stores/ui.js');

const item = (over: Partial<HealthCheckItem> = {}): HealthCheckItem =>
  ({
    id: 'userName',
    label: 'User name',
    status: 'warn',
    detail: 'user.name is not set',
    ...over
  }) as HealthCheckItem;

async function banner()
{
  const wrapper = mount(HealthBanner, { props: { context: {} as never } });
  await flushPromises();
  return wrapper;
}

const buttonNamed = (wrapper: Awaited<ReturnType<typeof banner>>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label);

/**
 * Take every mounted component down when its test ends: see CLAUDE.md. This one holds an
 * `event:repoChanged` subscription, which is exactly the kind of thing that outlives a test.
 */
enableAutoUnmount(afterEach);

describe('HealthBanner', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    health = [];
    checks = 0;
    subscribers.length = 0;
    commandsRun.length = 0;
  });

  it('draws nothing when every check passes', async () =>
  {
    health = [item({ status: 'ok' }), item({ id: 'git', status: 'ok' })];

    expect((await banner()).text()).toBe('');
  });

  it('counts the problems and leaves the passing checks out of it', async () =>
  {
    health = [item({ status: 'ok' }), item({ id: 'userEmail' }), item({ id: 'mergetool' })];

    expect((await banner()).text()).toContain('2 issues found');
  });

  it('says issue rather than issues for one', async () =>
  {
    health = [item()];

    expect((await banner()).text()).toContain('1 issue found');
  });

  describe('how bad it is', () =>
  {
    it('is a warning when nothing is worse than one', async () =>
    {
      health = [item({ status: 'warn' })];

      expect((await banner()).text()).toContain('Check your git setup');
    });

    /** One error among warnings is still an error: git will not work. */
    it('is an error when any check is one', async () =>
    {
      health = [item({ status: 'warn' }), item({ id: 'git', status: 'error' })];

      expect((await banner()).text()).toContain('Git is not ready');
    });
  });

  it('hides itself once dismissed', async () =>
  {
    health = [item()];
    const wrapper = await banner();

    await buttonNamed(wrapper, 'Dismiss')!.trigger('click');

    expect(wrapper.text()).toBe('');
    expect(useUiStore().healthDismissed).toBe(true);
  });

  it('shows what is wrong behind Details, and hides it again', async () =>
  {
    health = [item({ detail: 'user.name is not set' })];
    const wrapper = await banner();

    expect(wrapper.text()).not.toContain('user.name is not set');

    await buttonNamed(wrapper, 'Details')!.trigger('click');
    expect(wrapper.text()).toContain('user.name is not set');

    await buttonNamed(wrapper, 'Hide')!.trigger('click');
    expect(wrapper.text()).not.toContain('user.name is not set');
  });

  it('offers a fix only for a check that has one, and runs it', async () =>
  {
    health = [item({ id: 'userEmail', fixCommand: 'settings.open' }), item({ id: 'mergetool' })];
    const wrapper = await banner();
    await buttonNamed(wrapper, 'Details')!.trigger('click');

    expect(wrapper.findAll('li button')).toHaveLength(1);

    await wrapper.find('li button').trigger('click');
    await flushPromises();

    expect(commandsRun).toEqual(['settings.open']);
  });

  describe('staying right', () =>
  {
    /**
     * The Fix button opens the window that writes the config this banner reads. Without
     * this it would go on reporting a problem the user has just fixed from a dialog it
     * opened itself.
     */
    it('checks again when config changes', async () =>
    {
      health = [item()];
      await banner();
      const before = checks;

      subscribers.forEach((fire) => fire({ path: '/repo', facets: ['config'] }));
      await flushPromises();

      expect(checks).toBe(before + 1);
    });

    /** Every check but the git binary is a config read, so nothing else is worth a re-run. */
    it('does not check again for a change that touches no config', async () =>
    {
      health = [item()];
      await banner();
      const before = checks;

      subscribers.forEach((fire) => fire({ path: '/repo', facets: ['commits', 'head'] }));
      await flushPromises();

      expect(checks).toBe(before);
    });

    /** A repo-local `user.email` can answer a global one that is missing. */
    it('checks again when the repository changes', async () =>
    {
      health = [item()];
      await banner();
      const before = checks;

      useRepoStore().repo = {
        path: '/other',
        name: 'other',
        gitDir: '/other/.git',
        branch: 'main',
        head: null,
        isBare: false,
        superprojectPath: null
      };
      await flushPromises();

      expect(checks).toBe(before + 1);
    });

    it('stops listening once it is gone', async () =>
    {
      health = [item()];
      const wrapper = await banner();
      expect(subscribers).toHaveLength(1);

      wrapper.unmount();

      expect(subscribers).toHaveLength(0);
    });
  });
});
