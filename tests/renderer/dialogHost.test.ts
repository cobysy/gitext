// @vitest-environment happy-dom
/**
 * The dialog window's shell, mounted.
 *
 * Everything it does is wiring, and one piece of it is load-bearing beyond this file: **it
 * renders nothing until the repository has been adopted.** `ResolveConflictsDialog` reads
 * the store at setup and closes itself if there is nothing to resolve, which is only safe
 * because setup cannot run against a default: the gate below is what guarantees that, and
 * it is guaranteed here rather than in a comment.
 *
 * The rest is what a window does with a query string it did not write: an unknown name, and
 * a payload that will not parse. Both are bugs in the opener, and neither may produce a
 * blank window nobody can explain.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

/**
 * A gate every repository read waits behind, so a test can see what is drawn before
 * adoption finishes.
 *
 * One gate rather than a held reply, because `adopt` reads the repository more than once:
 * itself and then through `refresh`, and holding "the next call" strands whichever of them
 * comes second.
 */
let gate = Promise.resolve();
let openGate = (): void =>
{};

function holdAdoption(): void
{
  gate = new Promise<void>((resolve) =>
  {
    openGate = resolve;
  });
}

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'settings:get': () => Promise.resolve({}),
    'settings:patch': (next: unknown) => Promise.resolve(next),
    'dialog:close': () => Promise.resolve(),
    'dialog:fit': () => Promise.resolve(),
    'repo:info': async (path: string) =>
    {
      await gate;
      return { path, name: 'repo', gitDir: `${path}/.git` };
    },
    'repo:state': () =>
      Promise.resolve({ operation: 'none', conflictCount: 0, conflictedPaths: [] }),
    'repo:status': () => Promise.resolve(null),
    // Mounting a real dialog mounts its whole tree, and `CommitPicker`'s summary asks for
    // the revision it is showing. An unmocked channel here is an unhandled rejection, which
    // vitest reports as an error against the run whether or not an assertion noticed.
    'repo:revision': () => Promise.resolve(null),
    'refs:list': () => Promise.resolve([]),
    'remote:list': () => Promise.resolve([]),
    'stash:list': () => Promise.resolve([]),
    'worktree:list': () => Promise.resolve([]),
    'submodule:list': () => Promise.resolve([]),
    on: () => () =>
    {}
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

const DialogHost = (await import('@renderer/components/DialogHost.vue')).default;

/**
 * The query string `main/dialogs.ts` opens a window with. Set before mounting.
 *
 * `history.replaceState` rather than happy-dom's own `setURL`: it is the standard API, so
 * it type-checks without reaching for the environment's private handle, and `DialogHost`
 * reads `window.location.search` either way.
 */
function openWith(search: string): void
{
  window.history.replaceState({}, '', `/dialog.html${search}`);
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

describe('DialogHost', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    gate = Promise.resolve();
  });

  it('says so for a name no build has a component for', async () =>
  {
    openWith('?name=not.a.dialog&payload=%7B%7D');

    const host = mount(DialogHost);
    await flushPromises();

    expect(host.text()).toContain('Unknown dialog');
    expect(host.text()).toContain('not.a.dialog');
  });

  it('says so for a window opened with no name at all', async () =>
  {
    openWith('');

    const host = mount(DialogHost);
    await flushPromises();

    expect(host.text()).toContain('Unknown dialog');
  });

  /**
   * A payload that will not parse is the opener's bug. The dialog opens with no operand
   * and says so in its own form, which is better than a window that renders nothing.
   */
  it('survives a payload that is not JSON', async () =>
  {
    openWith('?name=branch.create&payload=not-json');

    const host = mount(DialogHost);
    await flushPromises();

    expect(host.text()).not.toContain('Unknown dialog');
  });

  /**
   * `useDialogKeyboard` polls for a field to focus, for up to a second, because an async
   * dialog's DOM is a comment node for several ticks after `ready`. A dialog with no field
   * at all is ordinary, so that poll runs its full second, and nothing awaits it.
   *
   * It has to stop when the window does. Otherwise a dialog dismissed as fast as it
   * appeared leaves a loop reading the document for the rest of that second, outliving the
   * component that started it.
   */
  it('stops looking for a field to focus once the window is gone', async () =>
  {
    openWith('?name=not.a.dialog&payload=%7B%7D');
    const host = mount(DialogHost);
    await flushPromises();

    const looks = vi.spyOn(document, 'querySelector');
    const before = looks.mock.calls.length;
    host.unmount();

    // Well past the poll's 30ms interval, so a loop still running would have looked again.
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(looks.mock.calls.length).toBe(before);
    looks.mockRestore();
  });

  /**
   * The gate `ResolveConflictsDialog` depends on. Until `adopt` has answered, the dialog's
   * own component must not exist: a component that read the store at setup would read a
   * default and act on a repository nobody has loaded.
   */
  describe('the render gate', () =>
  {
    it('draws no dialog while the repository is still being adopted', async () =>
    {
      holdAdoption();
      openWith('?name=branch.create&payload=%7B%22repoPath%22%3A%22%2Frepo%22%7D');

      const host = mount(DialogHost);
      await flushPromises();

      // Adoption has not answered, so nothing of the dialog is on screen yet.
      expect(host.findComponent({ name: 'CreateBranchDialog' }).exists()).toBe(false);
      expect(host.text()).not.toContain('Unknown dialog');
    });

    it('draws it once adoption has answered', async () =>
    {
      holdAdoption();
      openWith('?name=branch.create&payload=%7B%22repoPath%22%3A%22%2Frepo%22%7D');

      const host = mount(DialogHost);
      await flushPromises();
      openGate();
      // Two things have to land, not one: adoption, and the form's own import, which the
      // host starts at setup so the fetch runs beside the round trip rather than after it.
      await vi.waitFor(() =>
      {
        expect(host.findComponent({ name: 'CreateBranchDialog' }).exists()).toBe(true);
      });
    });
  });
});
