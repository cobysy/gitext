// @vitest-environment happy-dom

/**
 * What a different repository invalidates in the repository window.
 *
 * The rule is the wiring: one watcher in `App.vue` sees the open repository's path
 * change and drops the state that belonged to the one before it. That cannot be reached
 * as a function, and both halves of it have been wrong: the picks are SHAs from the
 * history that was open a moment ago, and the diff pivot derived from them sent those
 * SHAs to git under the new repository's path (`fatal: bad object`), while a setting
 * changing goes through the same watcher and must leave both alone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import {
  DEFAULT_SETTINGS,
  OPERATION_NONE,
  type CommitRow,
  type RepoInfo
} from '@shared/types.js';

let startedRequest = 0;

function noop(): void
{
}

function repoInfo(path: string): RepoInfo
{
  return {
    path,
    name: path,
    gitDir: `${path}/.git`,
    branch: 'main',
    head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    isBare: false,
    superprojectPath: null
  };
}

/**
 * The channels whose *shape* the window reads on mount. Everything else the shell asks
 * for is answered by the proxy below with a resolved promise: mounting the root reaches
 * the whole registry, the menu-state mirror and five panel reads, and listing them all
 * here would be a list to maintain about code this says nothing about. An unanswered
 * channel is an unhandled rejection, which vitest reports against the run rather than as
 * a failing test.
 */
const channels = {
  on: () => noop,
  'settings:get': () => Promise.resolve({ ...DEFAULT_SETTINGS }),
  'settings:patch': () => Promise.resolve({ ...DEFAULT_SETTINGS }),
  'log:list': () => Promise.resolve([]),
  'repo:open': (path: string) => Promise.resolve(repoInfo(path)),
  'repo:info': (path: string) => Promise.resolve(repoInfo(path)),
  'repo:state': () =>
    Promise.resolve({ operation: OPERATION_NONE, conflictCount: 0, conflictedPaths: [] }),
  'repo:status': () => Promise.resolve(null),
  'refs:list': () => Promise.resolve([]),
  'remote:list': () => Promise.resolve([]),
  'stash:list': () => Promise.resolve([]),
  'submodule:list': () => Promise.resolve([]),
  'worktree:list': () => Promise.resolve([]),
  'revisions:count': () => Promise.resolve(0),
  // The id the grid's rows have to be delivered under: a batch carrying any other one
  // is a stale stream's and is dropped.
  'revisions:start': (requestId: number) =>
  {
    startedRequest = requestId;
    return Promise.resolve();
  },
  'diff:files': () => Promise.resolve([]),
  'diff:patch': () => Promise.resolve('')
} as Record<string, (...args: never[]) => unknown>;

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: new Proxy(channels, {
    get: (target, name: string) => target[name] ?? (() => Promise.resolve(null))
  })
}));

/**
 * The diff panes reach the editor through this module, and it re-exports the whole
 * package: which resolves only through the app's own bundler. Shallow rendering stubs
 * the components but not their imports, so the module is answered here instead.
 */
vi.mock('@renderer/monaco.js', () => ({
  applyMonacoTheme: noop,
  monacoThemeName: () => 'vs',
  editor: { create: () => ({ dispose: noop }) },
  Uri: { parse: (value: string) => ({ toString: () => value }) }
}));

const App = (await import('@renderer/App.vue')).default;
const { useNavigationStore } = await import('@renderer/stores/navigation.js');
const { useRepoStore } = await import('@renderer/stores/repo.js');
const { useRevisionsStore } = await import('@renderer/stores/revisions.js');
const { useSelectionStore } = await import('@renderer/stores/selection.js');
const { useSettingsStore } = await import('@renderer/stores/settings.js');

enableAutoUnmount(afterEach);

const SHA_A = '1234567890123456789012345678901234567890';
const SHA_B = 'abcdef7890123456789012345678901234567890';

/** A row in the grid: only its SHA matters to anything under test. */
function commitRow(sha: string): CommitRow
{
  return {
    sha,
    parents: [],
    authorName: 'A',
    authorEmail: 'a@example.com',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@example.com',
    committerDate: 0,
    subject: sha.slice(0, 7),
    body: '',
    refs: [],
    note: ''
  };
}

describe('opening a different repository', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    // `DialogFrame` and the panes observe their own content; happy-dom has no observer.
    vi.stubGlobal(
      'ResizeObserver',
      class
      {
        observe = noop;
        unobserve = noop;
        disconnect = noop;
      }
    );
  });

  /**
   * The watchers under test are created inside `onMounted`, after it has awaited the
   * settings and the command log: so a single tick mounts the shell without them, and a
   * repository set in that gap would be the one they start from rather than a change
   * they see. A macrotask is what lets those two awaits finish.
   */
  function settled(): Promise<void>
  {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Mount the shell with a repository open and two commits picked in the grid. */
  async function mountWithSelection()
  {
    const wrapper = mount(App, { shallow: true });
    await settled();

    const repo = useRepoStore();
    repo.repo = repoInfo('/repo/a');
    await settled();

    // The grid has to be holding these commits, not just the selection. `retain` drops a
    // pick the loaded rows no longer contain, so against an empty grid it would empty the
    // selection by itself and the assertions below would pass with the rule deleted.
    useRevisionsStore().onBatch({
      requestId: startedRequest,
      commits: [commitRow(SHA_A), commitRow(SHA_B)],
      done: true
    });
    await nextTick();

    const selection = useSelectionStore();
    selection.select(SHA_A);
    selection.toggle(SHA_B);
    // The trail follows the selection through a watcher of its own, so it is recorded
    // on the flush rather than by the calls above.
    await nextTick();

    const navigation = useNavigationStore();
    expect(selection.picks).toEqual([SHA_A, SHA_B]);
    expect(navigation.entries.length).toBeGreaterThan(0);
    return { wrapper, repo, selection, navigation };
  }

  it('drops picks made in the repository that was open before it', async () =>
  {
    const { repo, selection } = await mountWithSelection();

    repo.repo = repoInfo('/repo/b');
    await nextTick();

    // Before anything derived from them reads them: the diff pivot is one of several,
    // and a pick here is a commit the newly opened repository has never heard of.
    expect(selection.picks).toEqual([]);
    expect(selection.primary).toBeNull();
  });

  it('drops the back and forward trail with them', async () =>
  {
    const { repo, navigation } = await mountWithSelection();

    repo.repo = repoInfo('/repo/b');
    await nextTick();

    expect(navigation.entries).toEqual([]);
    expect(navigation.canGoBack).toBe(false);
  });

  it('keeps both when a setting changes and the repository does not', async () =>
  {
    const { repo, selection } = await mountWithSelection();

    // The same watcher: the grid's query settings sit beside the path in its source.
    useSettingsStore().settings.commitLoadLimit = (DEFAULT_SETTINGS.commitLoadLimit ?? 0) + 500;
    await nextTick();

    expect(selection.picks).toEqual([SHA_A, SHA_B]);
    expect(repo.repo?.path).toBe('/repo/a');
  });
});
