// @vitest-environment happy-dom
/**
 * The push dialog opening on a push that failed somewhere else.
 *
 * Commit and Push runs `git push` in a window that has no answers to a rejection, so it
 * hands git's stderr over and this dialog reads it. That reading is the wiring: a
 * rejection has to arrive on the remedy screen, the three things that resolve it, and
 * anything else on the ordinary form with git's reason under it. Neither is visible from
 * `isRejectedPush` alone, which is unit-tested next door; what is tested here is that the
 * prop reaches the branch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';

const REJECTED_STDERR = ' ! [rejected]        main -> main (fetch first)';
const OTHER_FAILURE = 'fatal: unable to access: Could not resolve host: github.com';

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'dialog:close': () => Promise.resolve(),
    // `DialogFrame` measures itself and reports the height; nothing here reads the answer.
    'dialog:fit': () => Promise.resolve(),
    'remote:list': () =>
      Promise.resolve([{ name: 'origin', fetchUrl: 'git@host:r.git', pushUrl: 'git@host:r.git' }]),
    'remote:heads': () => Promise.resolve(['main'])
  }
}));

/** `DialogFrame` observes its own content; happy-dom has no `ResizeObserver`. */
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

const PushDialog = (await import('@renderer/components/dialogs/PushDialog.vue')).default;
const { useRepoStore } = await import('@renderer/stores/repo.js');

function openWith(failure?: string)
{
  const repo = useRepoStore();
  repo.repo = {
    path: '/repo',
    name: 'repo',
    gitDir: '/repo/.git',
    branch: 'main',
    head: null,
    isBare: false,
    superprojectPath: null
  };
  return mount(PushDialog, { props: { branch: 'main', failure } });
}

beforeEach(() =>
{
  setActivePinia(createPinia());
});

describe('PushDialog opened on a push that already failed', () =>
{
  it('opens on the remedy screen when git refused the push', () =>
  {
    const wrapper = openWith(REJECTED_STDERR);

    expect(wrapper.text()).toContain('What to do about it');
    expect(wrapper.text()).toContain('Pull with rebase, then push');
    // Its twin below is what makes this mean anything: the form really is gone, rather
    // than the selector never having matched.
    expect(wrapper.text()).not.toContain('Every branch');
  });

  it('opens on the ordinary form for a failure with no remedy to offer', () =>
  {
    const wrapper = openWith(OTHER_FAILURE);

    expect(wrapper.text()).toContain('Every branch');
    expect(wrapper.text()).not.toContain('What to do about it');
    // Still said, though: a window that opened blank after a push that failed elsewhere
    // would be the same silence this whole hand-off exists to end.
    expect(wrapper.text()).toContain('Could not resolve host');
  });

  it('opens on the form with nothing to report when nobody handed it a failure', () =>
  {
    const wrapper = openWith();

    expect(wrapper.text()).toContain('Every branch');
    expect(wrapper.text()).not.toContain('What to do about it');
  });
});
