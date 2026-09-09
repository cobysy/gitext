// @vitest-environment happy-dom
/**
 * The mid-operation banner, mounted.
 *
 * Two rules live here and nowhere else. **Which controls an operation gets**: a rebase can
 * be skipped and a cherry-pick cannot, a merge offers no Continue at all because continuing
 * one opens the commit screen instead, and **what each control runs**, which is a table of
 * argv per operation with no single wrong entry that anything else would notice.
 *
 * Both are rendering: the argv is chosen by a `computed` and reaches git through the button
 * that a `v-if` decided to draw. A wrong row in that table is a button that aborts the wrong
 * thing, and the only way to see it is to draw the banner and press what is there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { RepoFacet } from '@shared/invalidation.js';
import {
  OPERATION_AM,
  OPERATION_BISECT,
  OPERATION_CHERRY_PICK,
  OPERATION_MERGE,
  OPERATION_NONE,
  OPERATION_REBASE,
  OPERATION_REVERT,
  type InProgressOperation
} from '@shared/types.js';

const ran: { path: string; argv: string[]; facets: readonly RepoFacet[] }[] = [];
const openedDialogs: string[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'git:run': (path: string, argv: string[], facets: readonly RepoFacet[]) =>
    {
      ran.push({ path, argv, facets });
      return Promise.resolve('');
    },
    'dialog:open': (name: string) =>
    {
      openedDialogs.push(name);
      return Promise.resolve();
    },
    'repo:info': (path: string) => Promise.resolve({ path, name: 'repo', gitDir: `${path}/.git` }),
    'repo:state': () =>
      Promise.resolve({ operation: OPERATION_NONE, conflictCount: 0, conflictedPaths: [] }),
    'repo:status': () => Promise.resolve(null)
  }
}));

const OperationBanner = (await import('@renderer/components/OperationBanner.vue')).default;
const { useRepoStore } = await import('@renderer/stores/repo.js');

/** Draw the banner for a repository in the given state. */
function bannerFor(operation: InProgressOperation, conflicted: string[] = [])
{
  const repo = useRepoStore();
  repo.repo = {
    path: '/repo',
    name: 'repo',
    gitDir: '/repo/.git',
    branch: 'main',
    head: null,
    isBare: false,
    superprojectPath: null
  };
  repo.state = { operation, conflictCount: conflicted.length, conflictedPaths: conflicted };
  return mount(OperationBanner);
}

const labels = (banner: ReturnType<typeof mount>): string[] =>
  banner.findAll('button').map((b) => b.text());

const press = async (banner: ReturnType<typeof mount>, label: string): Promise<void> =>
{
  const button = banner.findAll('button').find((b) => b.text() === label);
  if (!button)
  {
    throw new Error(`no button labelled "${label}": found: ${labels(banner).join(', ')}`);
  }
  await button.trigger('click');
  await flushPromises();
};

/**
 * Take every mounted component down when its test ends.
 *
 * A component left mounted keeps whatever it bound to on mount: a window listener, an
 * observer, a watcher, a request still in flight, and goes on doing it against a store
 * from a pinia the next test has already replaced. That is how an error arrives with no
 * test attached to it, and how a keypress gets handled by a screen nobody is looking at.
 */
enableAutoUnmount(afterEach);

describe('OperationBanner', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    ran.length = 0;
    openedDialogs.length = 0;
  });

  it('draws nothing at all when git is not mid-operation', () =>
  {
    expect(bannerFor(OPERATION_NONE).text()).toBe('');
  });

  describe('which controls each operation gets', () =>
  {
    /**
     * Merge has no Continue on purpose: continuing one opens the commit screen pre-filled
     * from `MERGE_MSG`, which is a command rather than a button on this strip.
     */
    it('offers a merge only an Abort', () =>
    {
      expect(labels(bannerFor(OPERATION_MERGE))).toEqual(['Abort']);
    });

    it('offers a rebase all three, because a rebase can be skipped', () =>
    {
      expect(labels(bannerFor(OPERATION_REBASE))).toEqual(['Continue', 'Skip', 'Abort']);
    });

    it('offers a cherry-pick and a revert no Skip', () =>
    {
      expect(labels(bannerFor(OPERATION_CHERRY_PICK))).toEqual(['Continue', 'Abort']);
      expect(labels(bannerFor(OPERATION_REVERT))).toEqual(['Continue', 'Abort']);
    });

    it('offers an am all three, like a rebase', () =>
    {
      expect(labels(bannerFor(OPERATION_AM))).toEqual(['Continue', 'Skip', 'Abort']);
    });

    /**
     * Nothing in the app starts a bisect, but somebody can start one in a terminal with
     * this app open, and a state the app can see but not leave is worse than one it
     * cannot see.
     */
    it('offers a bisect a way out', () =>
    {
      expect(labels(bannerFor(OPERATION_BISECT))).toEqual(['Abort']);
    });
  });

  describe('what each control runs', () =>
  {
    it('continues, skips and aborts a rebase with its own argv', async () =>
    {
      await press(bannerFor(OPERATION_REBASE), 'Continue');
      await press(bannerFor(OPERATION_REBASE), 'Skip');
      await press(bannerFor(OPERATION_REBASE), 'Abort');

      expect(ran.map((call) => call.argv)).toEqual([
        ['rebase', '--continue'],
        ['rebase', '--skip'],
        ['rebase', '--abort']
      ]);
    });

    it('aborts a merge, a cherry-pick, a revert and an am as themselves', async () =>
    {
      await press(bannerFor(OPERATION_MERGE), 'Abort');
      await press(bannerFor(OPERATION_CHERRY_PICK), 'Abort');
      await press(bannerFor(OPERATION_REVERT), 'Abort');
      await press(bannerFor(OPERATION_AM), 'Abort');

      expect(ran.map((call) => call.argv)).toEqual([
        ['merge', '--abort'],
        ['cherry-pick', '--abort'],
        ['revert', '--abort'],
        ['am', '--abort']
      ]);
    });

    /** `bisect reset`, not `bisect --abort`: git spells this one as a subcommand. */
    it('leaves a bisect with `bisect reset`', async () =>
    {
      await press(bannerFor(OPERATION_BISECT), 'Abort');

      expect(ran[0]?.argv).toEqual(['bisect', 'reset']);
    });

    /** Every one of these moves HEAD and rewrites both trees. */
    it('declares a history move, so every window reloads', async () =>
    {
      await press(bannerFor(OPERATION_REBASE), 'Continue');

      expect(ran[0]?.facets).toEqual(['head', 'commits', 'refs', 'worktree', 'index']);
      expect(ran[0]?.path).toBe('/repo');
    });
  });

  describe('while there are conflicts', () =>
  {
    it('offers the resolver instead of Continue and Skip, and still offers Abort', () =>
    {
      const banner = bannerFor(OPERATION_REBASE, ['a.txt', 'b.txt']);

      expect(labels(banner)).toEqual(['Resolve Conflicts…', 'Abort']);
    });

    it('opens the resolver rather than running anything', async () =>
    {
      await press(bannerFor(OPERATION_MERGE, ['a.txt']), 'Resolve Conflicts…');

      expect(openedDialogs).toEqual(['conflicts.resolve']);
      expect(ran).toEqual([]);
    });

    it('counts them, and says conflict rather than conflicts for one', () =>
    {
      expect(bannerFor(OPERATION_MERGE, ['a.txt']).text()).toContain('1 conflict');
      expect(bannerFor(OPERATION_MERGE, ['a.txt', 'b.txt']).text()).toContain('2 conflicts');
    });

    it('names the operation it is about', () =>
    {
      expect(bannerFor(OPERATION_CHERRY_PICK).text()).toContain('Cherry-pick in progress');
      expect(bannerFor(OPERATION_AM).text()).toContain('Apply patch in progress');
    });
  });
});
