/**
 * Whether the left panel's selection follows a checkout.
 *
 * The bug: the marker for the current branch moved and the selection did not, so after
 * checking out `master` the panel went on pointing at the branch that had just been left.
 * The rule it must not break in fixing that: an ordinary reload, a watcher tick, an F5, a
 * commit on the branch you are already on: moves nothing, so it must leave the selection
 * wherever it was put.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { RefEntry } from '@shared/types.js';

let refs: RefEntry[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'refs:list': async () => refs,
    'remote:list': async () => [],
    'stash:list': async () => [],
    'submodule:list': async () => [],
    'worktree:list': async () => [],
    'refs:merged': async () => []
  }
}));

const { useRepoObjectsStore } = await import('@renderer/stores/repoObjects.js');

function branch(name: string, isCurrent: boolean): RefEntry
{
  return {
    fullName: `refs/heads/${name}`,
    name,
    kind: 'branch',
    sha: name,
    date: 0,
    isCurrent,
    upstream: null,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    remote: null,
    isAnnotated: false
  };
}

const ON_MASTER2 = (): RefEntry[] => [
  branch('feature', false),
  branch('master', false),
  branch('master2', true)
];
const ON_MASTER = (): RefEntry[] => [
  branch('feature', false),
  branch('master', true),
  branch('master2', false)
];

/** The panel's own id for a branch row, so a test never has to spell the format out. */
function nodeIdFor(objects: ReturnType<typeof useRepoObjectsStore>, ref: string): string
{
  return objects.rows.find((row) => row.node.ref === ref)!.node.id;
}

beforeEach(() =>
{
  setActivePinia(createPinia());
  refs = ON_MASTER2();
});

describe('the left panel across a checkout', () =>
{
  it('selects the current branch on the first load', async () =>
  {
    const objects = useRepoObjectsStore();
    await objects.load('/repo');
    expect(objects.selected?.ref).toBe('master2');
  });

  it('moves the selection to the branch that has been checked out', async () =>
  {
    const objects = useRepoObjectsStore();
    await objects.load('/repo');

    refs = ON_MASTER();
    await objects.load('/repo');

    expect(objects.selected?.ref).toBe('master');
  });

  it('follows the checkout even from a branch the user had gone and selected', async () =>
  {
    const objects = useRepoObjectsStore();
    await objects.load('/repo');
    objects.select(nodeIdFor(objects, 'feature'));
    expect(objects.selected?.ref).toBe('feature');

    refs = ON_MASTER();
    await objects.load('/repo');

    expect(objects.selected?.ref).toBe('master');
  });

  it('leaves the selection alone when the reload changed nothing', async () =>
  {
    const objects = useRepoObjectsStore();
    await objects.load('/repo');
    const elsewhere = nodeIdFor(objects, 'feature');
    objects.select(elsewhere);

    await objects.load('/repo');

    expect(objects.selectedId).toBe(elsewhere);
  });

  it('leaves the selection alone when HEAD detaches, having no branch to move to', async () =>
  {
    const objects = useRepoObjectsStore();
    await objects.load('/repo');

    refs = ON_MASTER2().map((entry) => ({ ...entry, isCurrent: false }));
    await objects.load('/repo');

    expect(objects.selected?.ref).toBe('master2');
  });
});
