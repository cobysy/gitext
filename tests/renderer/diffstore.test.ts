/**
 * The order the diff store reads in.
 *
 * Both reads are guarded against arriving out of order, but the guards only compare a
 * response to its own request: they cannot see that a patch was asked for using the
 * *previous* range's file. That is a real thing you can watch happen: step to another
 * commit and the pane draws, for a frame or two, a file the new commit does not touch.
 * It needs a fake `api` to reproduce, because the whole bug lives in which of two
 * answers lands first.
 *
 * `@renderer/api.js` reads `window.git` at import time, so it is mocked rather than
 * stubbed: the store under test is the thing being exercised, not the IPC surface.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { DiffFileEntry } from '@shared/diff.js';

/** One pending call, with the answer held back until the test gives it. */
type Pending<T> = { resolve: (value: T) => void };

const filesCalls: { args: unknown[]; pending: Pending<DiffFileEntry[]> }[] = [];
const patchCalls: {
  file: DiffFileEntry;
  pending: Pending<{ path: string; text: string; truncated: boolean }>;
}[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'diff:files': (...args: unknown[]) =>
      new Promise((resolve) =>
      {
        filesCalls.push({ args, pending: { resolve: resolve as (v: DiffFileEntry[]) => void } });
      }),
    'diff:patch': (_repo: string, _range: unknown, file: DiffFileEntry) =>
      new Promise((resolve) =>
      {
        patchCalls.push({
          file,
          pending: {
            resolve: resolve as (v: { path: string; text: string; truncated: boolean }) => void
          }
        });
      })
  }
}));

const { useDiffStore } = await import('@renderer/stores/diff.js');
const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useRevisionsStore } = await import('@renderer/stores/revisions.js');
const { useSelectionStore } = await import('@renderer/stores/selection.js');

const entry = (path: string): DiffFileEntry => ({
  path,
  status: 'modified',
  score: 0,
  kind: 'blob',
  mode: '100644',
  binary: false
});

/** Answer the file list request that is waiting, and let the watchers run. */
async function answerFiles(paths: string[]): Promise<void>
{
  filesCalls[filesCalls.length - 1]!.pending.resolve(paths.map(entry));
  await nextTick();
  await nextTick();
}

async function answerPatch(text: string): Promise<void>
{
  const call = patchCalls[patchCalls.length - 1]!;
  call.pending.resolve({ path: call.file.path, text, truncated: false });
  await nextTick();
  await nextTick();
}

async function openRepoAt(sha: string): Promise<void>
{
  const repo = useRepoStore();
  const revisions = useRevisionsStore();
  const selection = useSelectionStore();
  repo.repo = { path: '/repo' } as never;
  // The revisions have to exist: a selection is kept by SHA, and one naming a row that
  // was never loaded is dropped as soon as the layout is reconciled.
  revisions.commits = ['aaa', 'bbb'].map((s) => ({ sha: s, parents: [] }) as never);
  selection.select(sha);
  await nextTick();
}

beforeEach(() =>
{
  filesCalls.length = 0;
  patchCalls.length = 0;
  setActivePinia(createPinia());
});

describe('reading order', () =>
{
  it('does not fetch a patch until the file list for that range has landed', async () =>
  {
    const diff = useDiffStore();
    const selection = useSelectionStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts']);
    expect(patchCalls.map((call) => call.file.path)).toEqual(['one.ts']);
    await answerPatch('@@ one @@');

    // Step to a commit that does not touch `one.ts`. The file list is still the previous
    // commit's until git answers, and nothing may be asked about it in the meantime.
    selection.select('bbb');
    await nextTick();
    await nextTick();
    expect(patchCalls).toHaveLength(1);

    await answerFiles(['two.ts']);
    expect(patchCalls.map((call) => call.file.path)).toEqual(['one.ts', 'two.ts']);
    expect(diff.selectedPath).toBe('two.ts');
  });

  it('keeps following one file across commits, and asks about that file', async () =>
  {
    const diff = useDiffStore();
    const selection = useSelectionStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts', 'two.ts']);
    diff.select('two.ts');
    await nextTick();
    await answerPatch('@@ two @@');

    selection.select('bbb');
    await nextTick();
    await answerFiles(['one.ts', 'two.ts']);

    expect(patchCalls[patchCalls.length - 1]!.file.path).toBe('two.ts');
  });
});

describe('what stays on screen while a patch loads', () =>
{
  it('holds the last file whole until the next one is ready, then swaps in one go', async () =>
  {
    const diff = useDiffStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts', 'two.ts']);
    await answerPatch('@@ one @@');
    expect(diff.patch?.path).toBe('one.ts');

    diff.select('two.ts');
    await nextTick();
    // Not blanked. Blanking is what tore the editor out of the layout and put it back a
    // frame or three later: a flash on every click in the file list.
    expect(diff.patch?.path).toBe('one.ts');
    expect(diff.patchLoading).toBe(true);

    await answerPatch('@@ two @@');
    expect(diff.patch).toEqual({ path: 'two.ts', text: '@@ two @@', truncated: false });
  });

  it('names the file the patch is of, never the one the selection has moved to', async () =>
  {
    const diff = useDiffStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts', 'two.ts']);
    await answerPatch('@@ one @@');

    diff.select('two.ts');
    await nextTick();
    // The selection has moved and the body has not, so what the header draws must not
    // have moved either: the two together are one file or they are a lie. The header
    // reads the patch (through the viewer's `shown`), which is what this holds still.
    expect(diff.selectedPath).toBe('two.ts');
    expect(diff.patch?.path).toBe('one.ts');

    await answerPatch('@@ two @@');
    expect(diff.patch?.path).toBe('two.ts');
  });

  it('is the very same patch after a reload that answered the same thing', async () =>
  {
    const diff = useDiffStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts']);
    await answerPatch('@@ one @@');
    const held = diff.patch;

    // What the `.git` watcher does on any change at all. The viewer rebuilds its Monaco
    // models whenever this object changes, so an equal-but-new one is a flash of the file
    // being torn down and drawn again exactly as it was.
    const reload = diff.loadPatch();
    await answerPatch('@@ one @@');
    await reload;
    expect(diff.patch).toBe(held);
  });

  it('holds the same file’s patch while the next commit’s answer is on its way', async () =>
  {
    const diff = useDiffStore();
    const selection = useSelectionStore();

    await openRepoAt('aaa');
    await answerFiles(['one.ts']);
    await answerPatch('@@ one @@');

    selection.select('bbb');
    await nextTick();
    await answerFiles(['one.ts']);
    expect(diff.patch?.text).toBe('@@ one @@');

    await answerPatch('@@ one, later @@');
    expect(diff.patch?.text).toBe('@@ one, later @@');
  });
});
