/**
 * Which file the diff pane follows, and, the reason this file exists, when it follows
 * nothing at all.
 *
 * The changed-files list falls back to its first entry when no file has been asked for,
 * which is what makes selecting a commit show a diff instead of an empty pane. That
 * fallback is wrong for the *other* list: a path picked out of the revision tree may
 * simply not be among the files the commit touched, and answering with a different file's
 * diff puts one file's name over another file's lines: the failure the pane is least
 * able to admit to, because it looks exactly like a correct answer.
 *
 * `createSelectionState` takes its two dependencies as arguments and talks to no `api`, so
 * this needs no fake backend and no Pinia, which is the whole reason it is a factory.
 */

import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { DiffFileEntry } from '@shared/diff.js';
import { createSelectionState } from '@renderer/stores/diff/selection.js';

type PaneStub = Parameters<typeof createSelectionState>[0]['pane'];
type SettingsStub = Parameters<typeof createSelectionState>[0]['settings'];

/** The shared "which path is wanted" store, as much of it as this needs. */
function fakePane(wanted: string | null = null)
{
  const wantedPath = ref(wanted);
  return {
    get wantedPath()
    {
      return wantedPath.value;
    },
    want: (path: string | null) =>
    {
      wantedPath.value = path;
    },
    forget: () =>
    {
      wantedPath.value = null;
    }
  } as unknown as PaneStub;
}

function fakeSettings(filesPaneMode: 'changed' | 'tree')
{
  return {
    settings: { filesPaneMode, fileListDenseTree: false }
  } as unknown as SettingsStub;
}

const entry = (path: string): DiffFileEntry =>
  ({ path, status: 'modified' }) as unknown as DiffFileEntry;

const CHANGED = [entry('a.txt'), entry('b.txt')];

describe('the file the diff pane follows', () =>
{
  it('is the first changed file when nothing has been asked for', () =>
  {
    // Selecting a commit and getting an empty pane would make the pane look broken on the
    // most ordinary thing anyone does with it.
    const state = createSelectionState({ pane: fakePane(), settings: fakeSettings('changed') });
    state.files.value = CHANGED;
    expect(state.selectedPath.value).toBe('a.txt');
  });

  it('is the wanted file when this commit has one', () =>
  {
    const state = createSelectionState({
      pane: fakePane('b.txt'),
      settings: fakeSettings('changed')
    });
    state.files.value = CHANGED;
    expect(state.selectedPath.value).toBe('b.txt');
  });

  it('falls back when the wanted file is not among this commit’s changes', () =>
  {
    // Following a file across revisions: a commit that left it alone still shows *a* diff
    // rather than nothing, and the wanted path is kept for the next commit that has it.
    const state = createSelectionState({
      pane: fakePane('untouched.txt'),
      settings: fakeSettings('changed')
    });
    state.files.value = CHANGED;
    expect(state.selectedPath.value).toBe('a.txt');
  });

  it('does not fall back when the tree is the list being picked from', () =>
  {
    // The bug this guards: the tree lists every file in the repository, so most of what
    // can be clicked in it is not in `files` at all. Falling back would draw `a.txt`'s
    // diff under `untouched.txt`'s name.
    const state = createSelectionState({
      pane: fakePane('untouched.txt'),
      settings: fakeSettings('tree')
    });
    state.files.value = CHANGED;
    expect(state.selectedPath.value).toBeNull();
    expect(state.selectedFile.value).toBeNull();
  });

  it('still resolves a tree file the commit did change', () =>
  {
    // The other half, and the one the report was about: picking a changed file out of the
    // tree has to show its diff. Both lists put the path in the same place, so the diff
    // store finds it without knowing which list asked.
    const state = createSelectionState({
      pane: fakePane('b.txt'),
      settings: fakeSettings('tree')
    });
    state.files.value = CHANGED;
    expect(state.selectedPath.value).toBe('b.txt');
    expect(state.selectedFile.value?.path).toBe('b.txt');
  });

  it('has nothing to show when the commit changed nothing', () =>
  {
    const state = createSelectionState({ pane: fakePane(), settings: fakeSettings('changed') });
    state.files.value = [];
    expect(state.selectedPath.value).toBeNull();
  });
});
