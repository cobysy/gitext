/**
 * Which file the commit screen's patch is a patch *of*.
 *
 * The pane holds the patch that landed while git answers for the next one, so a click
 * never empties it, which means a stale patch *is* on screen for that gap, and
 * `applyHunk` builds a real `git apply` input out of it. The hunk commands are hotkeys,
 * so they can be reached during exactly that window. What pins it all is `patchTarget`:
 * the file and side the patch in hand is of, and therefore the file and side every hunk
 * action must read. These need a fake `api` because the whole of it lives in the gap
 * between asking and answering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { DiffFileEntry } from '@shared/diff.js';

const patchCalls: {
  file: DiffFileEntry;
  resolve: (value: { path: string; text: string; truncated: boolean }) => void;
  reject: (reason: unknown) => void;
}[] = [];

/** What each side lists. Two lists, because a hunk moves a file from one to the other. */
let listing: { unstaged: string[]; staged: string[] } = { unstaged: [], staged: [] };
/** The `git apply` calls, with their direction, which is half of what is being pinned. */
const applied: { patch: string; direction: string }[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'diff:files': (_repo: string, range: { to: { kind: string } }) =>
    {
      let side: 'unstaged' | 'staged';
      if (range.to.kind === 'workingTree')
      {
        side = 'unstaged';
      }
      else
      {
        side = 'staged';
      }
      return Promise.resolve(listing[side].map((path) => entry(path)));
    },
    'stage:indexFlags': () => Promise.resolve({ skipWorktree: [], assumeUnchanged: [] }),
    'stage:applyPatch': (_repo: string, patch: string, direction: string) =>
    {
      applied.push({ patch, direction });
      return Promise.resolve();
    },
    // `applyHunk` refreshes the repo before it refreshes the lists, and what it does
    // *after* that refresh, following the file it acted on, is under test here.
    'repo:info': () => Promise.resolve(null),
    'repo:state': () => Promise.resolve('clean'),
    'repo:status': () =>
      Promise.resolve({ branch: 'main', upstream: null, ahead: 0, behind: 0, files: [] }),
    'diff:patch': (_repo: string, _range: unknown, file: DiffFileEntry) =>
      new Promise((resolve, reject) =>
      {
        patchCalls.push({
          file,
          resolve: resolve as (v: { path: string; text: string; truncated: boolean }) => void,
          reject
        });
      }),
    // Fired unconditionally (`immediate: true`) the moment the commit state is created,
    // regardless of what a given test is exercising: unmocked, this is an unhandled
    // rejection on every store creation here.
    'git:readMessageFile': () => Promise.resolve('')
  }
}));

const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useStagingStore } = await import('@renderer/stores/staging.js');

function entry(path: string): DiffFileEntry
{
  return { path, status: 'modified', score: 0, kind: 'blob', mode: '100644', binary: false };
}

/** A one-hunk patch of `path`, the shape `applyHunk` would reverse out of. */
const patchOf = (path: string): string =>
  `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,2 +1,2 @@
 const first = 1;
-const second = 2;
+const second = 22;
`;

/** Answer the patch request that is waiting, with a patch of the file it asked about. */
async function answerPatch(): Promise<void>
{
  const call = patchCalls[patchCalls.length - 1]!;
  call.resolve({ path: call.file.path, text: patchOf(call.file.path), truncated: false });
  await nextTick();
  await nextTick();
}

/**
 * Wait until the fake has been asked for a patch it had not been asked for yet.
 *
 * Counting ticks does not do: the refresh inside `applyHunk` reads the repo and both
 * file lists before it asks for a patch, and how many microtasks that is is the shape of
 * those functions rather than anything this test means to pin.
 */
async function untilPatchCall(after: number): Promise<void>
{
  for (let i = 0; i < 50 && patchCalls.length <= after; i++)
  {
    await nextTick();
  }
}

/** Fail the patch request that is waiting, the way an unreadable file does. */
async function failPatch(): Promise<void>
{
  patchCalls[patchCalls.length - 1]!.reject(new Error('no such path'));
  await nextTick();
  await nextTick();
}

beforeEach(() =>
{
  patchCalls.length = 0;
  applied.length = 0;
  listing = { unstaged: ['one.ts', 'two.ts'], staged: ['one.ts', 'two.ts'] };
  setActivePinia(createPinia());
});

async function openScreen(): Promise<ReturnType<typeof useStagingStore>>
{
  const staging = useStagingStore();
  useRepoStore().repo = { path: '/repo' } as never;
  await staging.loadFiles();
  await nextTick();
  return staging;
}

describe('the patch belongs to a file and a side', () =>
{
  it('is readable once its own answer has landed', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    expect(staging.patchFile?.newPath).toBe('one.ts');
  });

  it('is the very same patch after a reload that answered the same thing', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();
    const held = staging.patchFile;

    // Every action on this screen ends in a refresh, and most of them leave the file being
    // looked at alone. A new object here rebuilds the rows and drops their syntax colour to
    // plain text and back: a flash, to redraw what was already there.
    const reload = staging.loadPatch();
    await answerPatch();
    await reload;
    expect(staging.patchFile).toBe(held);
  });

  it('keeps the file it has while another file’s patch is being read', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    staging.select('unstaged', 'two.ts');
    await nextTick();
    // Held, not blanked: emptying here is a blank pane on every click in the list. The
    // selection has moved and what is drawn has not, and `patchTarget` says so.
    expect(staging.selectedPath).toBe('two.ts');
    expect(staging.patchFile?.newPath).toBe('one.ts');
    expect(staging.patchTarget).toEqual({ path: 'one.ts', side: 'unstaged' });

    await answerPatch();
    expect(staging.patchFile?.newPath).toBe('two.ts');
    expect(staging.patchTarget).toEqual({ path: 'two.ts', side: 'unstaged' });
  });

  it('keeps the side it has while the other side’s patch is being read', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    // The same path on the other side is a different patch, and the button over it says
    // "Unstage" rather than "Stage". Until that patch lands the unstaged one is still what
    // is drawn, so the side the pane reads must still be the unstaged one.
    staging.select('staged', 'one.ts');
    await nextTick();
    expect(staging.side).toBe('staged');
    expect(staging.patchTarget?.side).toBe('unstaged');

    await answerPatch();
    expect(staging.patchTarget).toEqual({ path: 'one.ts', side: 'staged' });
  });

  it('stages the hunk that is on screen, not the file the selection has moved to', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    staging.select('unstaged', 'two.ts');
    await nextTick();
    // The hotkey lands in the gap. What it stages is what the pane was showing: `one.ts`
    //: because `applyHunk` takes its file and its direction from the patch in hand. The
    // old rule refused the call instead, which meant a hunk button that did nothing.
    //
    // Not awaited: `applyHunk` ends in a refresh, and the refresh's patch read is a
    // promise this fake only settles on request. What is being pinned is the `git apply`
    // it sent, which has happened by here.
    void staging.applyHunk(0);
    await nextTick();
    await nextTick();

    expect(applied).toHaveLength(1);
    expect(applied[0]!.patch).toContain('a/one.ts');
    expect(applied[0]!.patch).not.toContain('two.ts');
  });

  it('takes the direction from the patch on screen, not from the side that was clicked', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    // The same file on the other side: the selection says "staged" the instant it is
    // clicked, and the unstaged diff is still what is drawn until git answers.
    staging.select('staged', 'one.ts');
    await nextTick();
    expect(staging.side).toBe('staged');

    void staging.applyHunk(0);
    await nextTick();
    await nextTick();

    // A direction read from the selection would be `unstage` here, and it would hand
    // `git apply --reverse --cached` a patch describing the *working tree* side of the
    // file: a reverse-apply of lines the index does not have.
    expect(applied).toHaveLength(1);
    expect(applied[0]!.direction).toBe('stage');
  });

  it('follows the file it acted on, not the one the selection had moved to', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    staging.select('unstaged', 'two.ts');
    await nextTick();

    // The whole of `one.ts` goes into the index, so it leaves the unstaged list. The
    // selection must land on it where it now is, rather than staying on `two.ts`, which
    // is what taking the acted-on file from the patch buys, and what taking it from the
    // selection would have got wrong.
    listing.unstaged = ['two.ts'];

    const before = patchCalls.length;
    const acted = staging.applyHunk(0);
    await untilPatchCall(before);
    await answerPatch();
    await acted;

    expect(staging.side).toBe('staged');
    expect(staging.selectedPath).toBe('one.ts');
  });

  it('carries a path with a space in it through whole', async () =>
  {
    listing = { unstaged: ['src/my file.ts'], staged: [] };
    const staging = await openScreen();
    staging.select('unstaged', 'src/my file.ts');
    await nextTick();
    await answerPatch();

    // The target is the path and the side kept apart, so no separator can be read back
    // wrongly: a path is full of characters something would have had to escape.
    expect(staging.patchTarget).toEqual({ path: 'src/my file.ts', side: 'unstaged' });

    void staging.applyHunk(0);
    await nextTick();
    await nextTick();
    expect(applied[0]!.patch).toContain('a/src/my file.ts');
  });

  it('has nothing to act on when the read failed', async () =>
  {
    const staging = await openScreen();
    staging.select('unstaged', 'one.ts');
    await nextTick();
    await answerPatch();

    staging.select('unstaged', 'two.ts');
    await nextTick();
    await failPatch();

    // A failure is the one case where holding the last patch would be a lie: there is an
    // error where the diff was, so nothing is drawn, and nothing may be applied either.
    expect(staging.patchTarget).toBeNull();
    expect(staging.patchFile).toBeNull();
    expect(await staging.applyHunk(0)).toBe(false);
    expect(applied).toEqual([]);
  });
});
