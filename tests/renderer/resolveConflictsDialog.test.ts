// @vitest-environment happy-dom
/**
 * The conflict resolver, mounted.
 *
 * The first component test here, and it exists for a rule that only shows up once the
 * component is running: *when this window decides it has nothing left to do*. That
 * decision reads the store at setup and again on every change, and both readings have been
 * wrong: closing on an operation ending shut the window in the case it was opened for,
 * and watching only the transition left a window open forever when the operation ended
 * while it was still loading.
 *
 * `nothingToResolve` is unit-tested on its own. What is tested here is the wiring around
 * it: that the component asks at mount as well as on a change, and that asking turns into
 * `dialog:close`.
 *
 * Node is still the default environment for this suite: see `vitest.config.ts`. The
 * docblock above opts this file in, so the DOM costs only the files that mount something.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import {
  OPERATION_MERGE,
  OPERATION_NONE,
  type InProgressOperation
} from '@shared/types.js';

const closed = vi.fn();

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'dialog:close': () =>
    {
      closed();
      return Promise.resolve();
    },
    // `DialogFrame` measures itself and reports the height; nothing here reads the answer.
    'dialog:fit': () => Promise.resolve(),
    // Read once on mount, for the per-side button labels. An `am` legitimately has none.
    'conflicts:readSides': () => Promise.resolve({ ours: null, theirs: null })
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

const ResolveConflictsDialog = (
  await import('@renderer/components/dialogs/ResolveConflictsDialog.vue')
).default;
const { useRepoStore } = await import('@renderer/stores/repo.js');

/**
 * Put the store where a window opening now would find it, then mount.
 *
 * The order is the point: `DialogHost` gates the render on the repository having been
 * adopted, so a real resolver never sees a default. Setting the state first is what makes
 * this the same situation.
 */
function openOn(operation: InProgressOperation, conflicted: string[])
{
  const repo = useRepoStore();
  repo.repo = { path: '/repo', name: 'repo', gitDir: '/repo/.git', branch: 'main', head: null, isBare: false, superprojectPath: null };
  repo.state = { operation, conflictCount: conflicted.length, conflictedPaths: conflicted };
  return mount(ResolveConflictsDialog);
}

/** Move the repository underneath a window that is already open. */
async function moveTo(operation: InProgressOperation, conflicted: string[]): Promise<void>
{
  useRepoStore().state = {
    operation,
    conflictCount: conflicted.length,
    conflictedPaths: conflicted
  };
  await nextTick();
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

describe('ResolveConflictsDialog closing itself', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    closed.mockClear();
  });

  it('stays open on an operation with conflicts in it', () =>
  {
    openOn(OPERATION_MERGE, ['a.txt', 'b.txt']);
    expect(closed).not.toHaveBeenCalled();
  });

  /**
   * A stash pop and a squashed merge leave conflicts with nothing in progress, and are why
   * this window can be opened outside an operation at all.
   */
  it('stays open for conflicts that belong to no operation', () =>
  {
    openOn(OPERATION_NONE, ['a.txt']);
    expect(closed).not.toHaveBeenCalled();
  });

  /** Every file resolved, the operation still waiting to be continued. */
  it('stays open on an operation whose conflicts are all resolved', () =>
  {
    openOn(OPERATION_MERGE, []);
    expect(closed).not.toHaveBeenCalled();
  });

  /**
   * The regression a transition-only watch could not see: the raise is asynchronous, so an
   * operation that ends while this window is loading leaves no edge to detect and the
   * window sat there titled for something that had finished.
   */
  it('closes at once when it opens on an operation that has already ended', () =>
  {
    openOn(OPERATION_NONE, []);
    expect(closed).toHaveBeenCalled();
  });

  it('closes when the operation is aborted underneath it', async () =>
  {
    openOn(OPERATION_MERGE, ['a.txt']);
    expect(closed).not.toHaveBeenCalled();

    await moveTo(OPERATION_NONE, []);

    expect(closed).toHaveBeenCalled();
  });

  it('stays open when the operation ends but conflicts are still there', async () =>
  {
    openOn(OPERATION_MERGE, ['a.txt']);

    // What a squashed merge that stopped leaves behind: no operation, still conflicted.
    await moveTo(OPERATION_NONE, ['a.txt']);

    expect(closed).not.toHaveBeenCalled();
  });

  it('closes as the last conflict is resolved and the operation finishes', async () =>
  {
    openOn(OPERATION_MERGE, ['a.txt', 'b.txt']);
    await moveTo(OPERATION_MERGE, ['b.txt']);
    expect(closed).not.toHaveBeenCalled();

    await moveTo(OPERATION_NONE, []);

    expect(closed).toHaveBeenCalled();
  });
});
