/**
 * The grid's rows, as everything downstream of them sees them.
 *
 * The virtualizer's row count, the graph's props and the ancestry marks are all computed
 * from `rows`, and a computed only tells its readers when the value it returns is a
 * different one. The commits are appended into one array batch by batch, so a `rows` that
 * handed that array back would report the first batch of a read and then go quiet: the
 * grid sized to part of the history, the rest unreachable by scrolling. A clean working
 * tree is the case that reaches it, since its rows are the commits and nothing else.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { DEFAULT_SETTINGS, type CommitRow } from '@shared/types.js';

let startedRequest = 0;

const channels = {
  'settings:get': () => Promise.resolve({ ...DEFAULT_SETTINGS }),
  'revisions:count': () => Promise.resolve(0),
  'revisions:cancel': () => Promise.resolve(),
  'revisions:start': (requestId: number) =>
  {
    startedRequest = requestId;
    return Promise.resolve();
  }
} as Record<string, (...args: never[]) => unknown>;

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: new Proxy(channels, {
    get: (target, name: string) => target[name] ?? (() => Promise.resolve(null))
  })
}));

const { useRevisionsStore } = await import('@renderer/stores/revisions.js');

function commitRow(n: number): CommitRow
{
  return {
    sha: n.toString(16).padStart(40, '0'),
    parents: [],
    authorName: 'A',
    authorEmail: 'a@example.com',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@example.com',
    committerDate: 0,
    subject: `c ${n}`,
    body: '',
    refs: [],
    note: ''
  };
}

describe('rows on a clean working tree', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
  });

  it('reports every batch of a read to what is computed from it, not only the first', async () =>
  {
    const revisions = useRevisionsStore();
    const drawn = computed(() => revisions.rows.length);

    await revisions.load('/repo');
    revisions.onBatch({ requestId: startedRequest, commits: [commitRow(1), commitRow(2)], done: false });
    expect(drawn.value).toBe(2);

    revisions.onBatch({ requestId: startedRequest, commits: [commitRow(3)], done: false });
    revisions.onBatch({ requestId: startedRequest, commits: [commitRow(4)], done: true });
    expect(revisions.artificialRows).toHaveLength(0);
    expect(drawn.value).toBe(4);
  });
});
