/**
 * Commit and Push, when git refuses the push.
 *
 * The button ran two commands and read the result of one. A push refused because the
 * remote had moved set the error and returned false, and the commit's own `true` closed
 * the window over it: so the commit landed, the push did not, and nothing said so. The
 * next thing that happened was a push typed by hand, which met the same rejection and the
 * same three answers this app already knows.
 *
 * What is pinned here is the hand-off: git's own words reach the push dialog, and the
 * commit screen closes *before* that window is asked for. The order is the whole of it:
 * reversed, the push window is parented to a window on its way out and dies with it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { DiffFileEntry } from '@shared/diff.js';

/** Every git command the store ran, in order. */
const ran: string[][] = [];
/** The dialog messages, in order, which is what this test is about. */
const messages: { channel: string; name?: string; payload?: Record<string, unknown> }[] = [];
/** What `git push` does. Null is success; a string is stderr on a non-zero exit. */
let pushFails: string | null = null;

const REJECTED_STDERR = [
  'To github.com:someone/repo.git',
  ' ! [rejected]        main -> main (fetch first)',
  "error: failed to push some refs to 'github.com:someone/repo.git'"
].join('\n');

/** `event:streamLine` listeners, which is how a streamed run reports: see `gitConsole.ts`. */
const streamListeners: ((batch: unknown) => void)[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String((err as Error).message ?? err),
  api: {
    on: (channel: string, listener: (batch: unknown) => void) =>
    {
      if (channel === 'event:streamLine')
      {
        streamListeners.push(listener);
      }
      return () =>
      {
        const at = streamListeners.indexOf(listener);
        if (at >= 0)
        {
          streamListeners.splice(at, 1);
        }
      };
    },
    // The push is streamed rather than buffered: it goes over the network, so the
    // console window watches it. Answered here as one closing batch.
    'stream:start': (requestId: number, _repo: string, argv: string[]) =>
    {
      ran.push(argv);
      let lines: string[] = [];
      let exitCode = 0;
      if (argv[0] === 'push' && pushFails !== null)
      {
        lines = pushFails.split('\n');
        exitCode = 1;
      }
      // A tick later, as a real batch is: the caller subscribes before this resolves.
      queueMicrotask(() =>
      {
        for (const listener of [...streamListeners])
        {
          listener({ requestId, lines, done: true, exitCode });
        }
      });
      return Promise.resolve();
    },
    'dialog:openOutput': (payload: Record<string, unknown>) =>
    {
      messages.push({ channel: 'dialog:openOutput', payload });
      return Promise.resolve();
    },
    'git:run': (_repo: string, argv: string[]) =>
    {
      ran.push(argv);
      if (argv[0] === 'push' && pushFails !== null)
      {
        return Promise.reject(new Error(pushFails));
      }
      return Promise.resolve('');
    },
    'dialog:open': (name: string, payload: Record<string, unknown>) =>
    {
      messages.push({ channel: 'dialog:open', name, payload });
      return Promise.resolve();
    },
    'dialog:close': () =>
    {
      messages.push({ channel: 'dialog:close' });
      return Promise.resolve();
    },
    'diff:files': (_repo: string, range: { to: { kind: string } }) =>
    {
      if (range.to.kind === 'workingTree')
      {
        return Promise.resolve([]);
      }
      return Promise.resolve([entry('one.ts')]);
    },
    'diff:patch': () => Promise.resolve({ path: 'one.ts', text: '', truncated: false }),
    'stage:indexFlags': () => Promise.resolve({ skipWorktree: [], assumeUnchanged: [] }),
    'repo:info': () => Promise.resolve(null),
    'repo:state': () => Promise.resolve('clean'),
    'repo:status': () =>
      Promise.resolve({ branch: 'main', upstream: null, ahead: 0, behind: 0, files: [] }),
    // Fires on an `immediate: true` watcher the moment the commit state exists.
    'git:readMessageFile': () => Promise.resolve('')
  }
}));

const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useStagingStore } = await import('@renderer/stores/staging.js');

function entry(path: string): DiffFileEntry
{
  return { path, status: 'modified', score: 0, kind: 'blob', mode: '100644', binary: false };
}

beforeEach(() =>
{
  ran.length = 0;
  messages.length = 0;
  streamListeners.length = 0;
  pushFails = null;
  setActivePinia(createPinia());
});

/** A screen with one staged file and a message: the state the button is enabled in. */
async function readyToCommit(): Promise<ReturnType<typeof useStagingStore>>
{
  const staging = useStagingStore();
  useRepoStore().repo = { path: '/repo', branch: 'main' } as never;
  await staging.loadFiles();
  await nextTick();
  staging.message = 'a change';
  return staging;
}

describe('commit and push', () =>
{
  it('runs the commit and then the push', async () =>
  {
    const staging = await readyToCommit();

    expect(await staging.commit({ push: true })).toBe(true);

    expect(ran).toEqual([['commit', '-m', 'a change'], ['push']]);
    // The console for the push, and nothing else: a push that worked closes no window
    // and opens no dialog.
    expect(messages.map((message) => message.channel)).toEqual(['dialog:openOutput']);
  });

  it('pushes nothing when the button was the plain Commit', async () =>
  {
    const staging = await readyToCommit();

    await staging.commit();

    expect(ran).toEqual([['commit', '-m', 'a change']]);
  });

  it('hands a refused push to the push dialog, in git\'s own words', async () =>
  {
    pushFails = REJECTED_STDERR;
    const staging = await readyToCommit();

    // The commit is what this reports: it ran, and the window closes on it either way.
    expect(await staging.commit({ push: true })).toBe(true);

    // Closed before the window that replaces it is asked for. The other order parents the
    // push dialog to a window that is closing, and it goes with it.
    expect(messages.map((message) => message.channel)).toEqual([
      'dialog:openOutput',
      'dialog:close',
      'dialog:open'
    ]);
    const open = messages[2]!;
    expect(open.name).toBe('remote.push');
    expect(open.payload?.ref).toBe('main');
    expect(open.payload?.pushRejection).toContain('[rejected]');
  });

  it('hands over a push that failed for any other reason too', async () =>
  {
    // No upstream, no network, a hook that said no: none of them are answered here either,
    // and closing over them is the same silence the rejection case was.
    pushFails = "fatal: The current branch main has no upstream branch.";
    const staging = await readyToCommit();

    await staging.commit({ push: true });

    expect(messages.map((message) => message.channel)).toEqual([
      'dialog:openOutput',
      'dialog:close',
      'dialog:open'
    ]);
    expect(messages[2]?.payload?.pushRejection).toContain('no upstream branch');
  });
});
