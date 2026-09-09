/**
 * When the resolver is raised for conflicts nobody's command produced.
 *
 * The rule is a transition, not a value: a repository that moves underneath the window:
 * a merge run in a terminal, a repository opened part-way through one: has to surface
 * its conflicts, and one that is sitting at three of them while they are being worked
 * through has already surfaced them. Getting that wrong in the other direction is a
 * window that takes focus back on every tick of the count.
 *
 * `@renderer/api.js` reads `window.git` at import time and `currentDialogName` reads
 * `window.location`, so both are mocked: what is under test is the decision, not the IPC
 * surface or the URL a dialog window is loaded with.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { OPERATION_MERGE, OPERATION_NONE } from '@shared/types.js';
import type { DialogName, DialogOpenOptions, DialogPayload } from '@shared/dialogs.js';

const opened: { name: DialogName; payload: DialogPayload; options?: DialogOpenOptions }[] = [];

/** What `repo:state` answers for each repository path, for the switch below. */
const stateByPath = new Map<string, { operation: string; conflictedPaths: string[] }>();

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'dialog:open': (name: DialogName, payload: DialogPayload, options?: DialogOpenOptions) =>
    {
      opened.push({ name, payload, options });
      return Promise.resolve();
    },
    'repo:open': (path: string) => Promise.resolve({ path, name: path, gitDir: `${path}/.git` }),
    'repo:info': (path: string) => Promise.resolve({ path, name: path, gitDir: `${path}/.git` }),
    'repo:state': (path: string) =>
    {
      const entry = stateByPath.get(path) ?? { operation: OPERATION_NONE, conflictedPaths: [] };
      return Promise.resolve({
        operation: entry.operation,
        conflictCount: entry.conflictedPaths.length,
        conflictedPaths: entry.conflictedPaths
      });
    },
    'repo:status': () => Promise.resolve(null),
    'repo:watch': () => Promise.resolve(),
    'repo:unwatch': () => Promise.resolve(),
    'settings:get': () => Promise.resolve({})
  }
}));

/** Which window this is. `null` is the repository window; the resolver names itself. */
let dialogName: string | null = null;
vi.mock('@renderer/dialogs/current.js', () => ({
  currentDialogName: () => dialogName
}));

const { useAfterGitOperation } = await import('@renderer/composables/useAfterGitOperation.js');
const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useUiStore } = await import('@renderer/stores/ui.js');

/** Move the repository's conflict count, the way a refresh off a broadcast does. */
async function conflictCount(count: number): Promise<void>
{
  const repo = useRepoStore();
  let operation;
  if (count > 0)
  {
    operation = OPERATION_MERGE;
  }
  else
  {
    operation = OPERATION_NONE;
  }
  repo.state = {
    operation,
    conflictCount: count,
    conflictedPaths: Array.from({ length: count }, (_, index) => `file-${index}.txt`)
  };
  await nextTick();
}

describe('conflicts appearing from outside the app', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    opened.length = 0;
    dialogName = null;
    useAfterGitOperation().watchForConflicts();
  });

  it('raises the resolver when the count goes from none to some', async () =>
  {
    await conflictCount(2);
    expect(opened.map((call) => call.name)).toEqual(['conflicts.resolve']);
  });

  it('marks the raise automatic, so it never displaces an open dialog', async () =>
  {
    await conflictCount(1);
    expect(opened[0]?.options).toEqual({ automatic: true });
  });

  it('does not raise again while conflicts are being worked through', async () =>
  {
    await conflictCount(3);
    await conflictCount(2);
    await conflictCount(1);
    expect(opened).toHaveLength(1);
  });

  it('raises again for a second operation, once the first has gone quiet', async () =>
  {
    await conflictCount(1);
    await conflictCount(0);
    await conflictCount(4);
    expect(opened).toHaveLength(2);
  });

  it('stays quiet in the resolver window itself', async () =>
  {
    dialogName = 'conflicts.resolve';
    await conflictCount(2);
    expect(opened).toHaveLength(0);
  });
});

/**
 * Arriving at a repository that is already mid-merge.
 *
 * The count is a transition, and a store that carried the previous repository's count into
 * the next one turns "three conflicts, then one" into a change *downwards*: so opening a
 * conflicted repository from a conflicted one surfaced nothing.
 */
describe('switching to a repository that has conflicts', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    opened.length = 0;
    dialogName = null;
    stateByPath.clear();
    useAfterGitOperation().watchForConflicts();
  });

  it('raises the resolver for the repository being opened', async () =>
  {
    stateByPath.set('/second', { operation: OPERATION_MERGE, conflictedPaths: ['a.txt'] });

    await conflictCount(3);
    opened.length = 0;
    await useRepoStore().open('/second');
    await nextTick();

    expect(opened.map((call) => call.name)).toEqual(['conflicts.resolve']);
  });

  it('stays quiet for a repository that has none', async () =>
  {
    await conflictCount(3);
    opened.length = 0;
    await useRepoStore().open('/clean');
    await nextTick();

    expect(opened).toHaveLength(0);
  });
});

/**
 * What an automatic raise will not interrupt.
 *
 * `main/ipc/index.ts` drops one that would land over another dialog *window*; these are the
 * two modals a window draws inside itself, which main cannot see.
 */
describe('an automatic raise over this window’s own modals', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    opened.length = 0;
    dialogName = null;
  });

  it('is dropped while the command palette is open', async () =>
  {
    const ui = useUiStore();
    ui.openPalette();

    ui.openDialog('conflicts.resolve', {}, { automatic: true });

    expect(opened).toHaveLength(0);
    // And the palette is still there: the point of not sending is not losing it.
    expect(ui.paletteOpen).toBe(true);
  });

  it('is dropped while a confirmation is unanswered', () =>
  {
    const ui = useUiStore();
    void ui.confirm({ title: 'Delete', message: 'Sure?' });

    ui.openDialog('conflicts.resolve', {}, { automatic: true });

    expect(opened).toHaveLength(0);
  });

  it('still opens when the window is holding nothing', () =>
  {
    useUiStore().openDialog('conflicts.resolve', {}, { automatic: true });

    expect(opened.map((call) => call.name)).toEqual(['conflicts.resolve']);
  });

  /** A dialog the user asked for takes the palette with it, as it always has. */
  it('closes the palette for a raise somebody asked for', () =>
  {
    const ui = useUiStore();
    ui.openPalette();

    ui.openDialog('conflicts.resolve');

    expect(opened).toHaveLength(1);
    expect(ui.paletteOpen).toBe(false);
  });
});
