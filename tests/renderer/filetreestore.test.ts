/**
 * The order the file tree reads in: the sibling of `diffstore.test.ts`, and the same bug
 * shape: `newestOnly` compares an answer to its own request, never to the list it came from.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { DiffEndpoint, DiffFileEntry } from '@shared/diff.js';
import type { BlobContents, TreeEntry } from '@shared/tree.js';

type Pending<T> = { resolve: (value: T) => void };

const listCalls: { pending: Pending<TreeEntry[]> }[] = [];
const blobCalls: { endpoint: DiffEndpoint; entry: TreeEntry }[] = [];
const filesCalls: { pending: Pending<DiffFileEntry[]> }[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'tree:list': () =>
      new Promise((resolve) =>
      {
        listCalls.push({ pending: { resolve: resolve as (v: TreeEntry[]) => void } });
      }),
    'tree:blob': (_repo: string, endpoint: DiffEndpoint, entry: TreeEntry) =>
    {
      blobCalls.push({ endpoint, entry });
      return new Promise<BlobContents>(() =>
      {});
    },
    'diff:files': () =>
      new Promise((resolve) =>
      {
        filesCalls.push({ pending: { resolve: resolve as (v: DiffFileEntry[]) => void } });
      }),
    'diff:patch': () => new Promise(() =>
    {})
  }
}));

const { useDiffStore } = await import('@renderer/stores/diff.js');
const { useFileTreeStore } = await import('@renderer/stores/fileTree.js');
const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useRevisionsStore } = await import('@renderer/stores/revisions.js');
const { useSelectionStore } = await import('@renderer/stores/selection.js');
const { useSettingsStore } = await import('@renderer/stores/settings.js');

const treeEntry = (path: string): TreeEntry => ({ path, kind: 'blob', mode: '100644' });

const diffEntry = (path: string): DiffFileEntry => ({
  path,
  status: 'modified',
  score: 0,
  kind: 'blob',
  mode: '100644',
  binary: false
});

async function settle(): Promise<void>
{
  await nextTick();
  await nextTick();
}

async function answerList(paths: string[]): Promise<void>
{
  listCalls[listCalls.length - 1]!.pending.resolve(paths.map(treeEntry));
  await settle();
}

async function answerFiles(paths: string[]): Promise<void>
{
  filesCalls[filesCalls.length - 1]!.pending.resolve(paths.map(diffEntry));
  await settle();
}

/** What each blob read asked for, as the pair that has to be real: revision and path. */
function asked(): { sha: string; path: string }[]
{
  return blobCalls.map((call) =>
  {
    let sha: string;
    if (call.endpoint.kind === 'commit')
    {
      sha = call.endpoint.sha;
    }
    else
    {
      sha = call.endpoint.kind;
    }
    return { sha, path: call.entry.path };
  });
}

function showContents(mode: 'tree' | 'changed'): void
{
  const settings = useSettingsStore();
  settings.settings.filesPaneMode = mode;
  settings.settings.filePaneView = 'file';
}

async function openRepoAt(sha: string): Promise<void>
{
  const repo = useRepoStore();
  const revisions = useRevisionsStore();
  const selection = useSelectionStore();
  repo.repo = { path: '/repo' } as never;
  revisions.commits = ['aaa', 'bbb'].map((s) => ({ sha: s, parents: [] }) as never);
  selection.select(sha);
  await settle();
}

beforeEach(() =>
{
  listCalls.length = 0;
  blobCalls.length = 0;
  filesCalls.length = 0;
  setActivePinia(createPinia());
});

describe('reading order', () =>
{
  it('does not read a blob until the listing for that revision has landed', async () =>
  {
    showContents('tree');
    const tree = useFileTreeStore();

    await openRepoAt('aaa');
    await answerList(['one.ts', 'two.ts']);
    tree.select('one.ts');
    await settle();
    expect(asked()).toEqual([{ sha: 'aaa', path: 'one.ts' }]);

    // Another commit, whose listing is still on its way. Asking now would pair the new
    // revision with the old listing's path: a path it need never have had.
    useSelectionStore().select('bbb');
    await settle();
    expect(asked()).toHaveLength(1);

    await answerList(['one.ts']);
    expect(asked()).toEqual([
      { sha: 'aaa', path: 'one.ts' },
      { sha: 'bbb', path: 'one.ts' }
    ]);
  });

  it('waits on the changed list too, when that is what the pane is picking from', async () =>
  {
    showContents('changed');
    useFileTreeStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts']);
    expect(asked()).toEqual([{ sha: 'aaa', path: 'one.ts' }]);

    useSelectionStore().select('bbb');
    await settle();
    expect(asked()).toHaveLength(1);

    await answerFiles(['one.ts', 'two.ts']);
    expect(asked()).toEqual([
      { sha: 'aaa', path: 'one.ts' },
      { sha: 'bbb', path: 'one.ts' }
    ]);
  });

  it('never reads a listing while the changed list is the one on screen', async () =>
  {
    showContents('changed');
    useFileTreeStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts']);
    expect(listCalls).toHaveLength(0);
    expect(useDiffStore().selectedPath).toBe('one.ts');
  });
});
