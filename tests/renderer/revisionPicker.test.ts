// @vitest-environment happy-dom
/**
 * The revision picker resolving what is typed into it, mounted.
 *
 * It asks git on every keystroke: deliberately, because a `git log -1` is cheap and
 * debouncing would make "no such revision" arrive after the line that says otherwise. What
 * that costs is order: two `describe`s started a keystroke apart come back in whatever
 * order they finish, and the answer that lands last wins unless something stops it.
 *
 * The row it writes is one Enter picks, and the pickers feed Reset, Merge, Compare and the
 * rest: so a stale answer here is a dialog running on a revision nobody typed. That is a
 * race, and a race is only testable by holding one reply until after the next.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

/** Replies held open by revision text, so a test decides which lands first. */
const pending = new Map<string, (summary: unknown) => void>();
const asked: string[] = [];

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    'revisions:describe': (_path: string, rev: string) =>
    {
      asked.push(rev);
      return new Promise((resolve) => pending.set(rev, resolve));
    },
    'repo:revision': () => Promise.resolve(null),
    'refs:list': () => Promise.resolve([]),
    'remote:list': () => Promise.resolve([]),
    'stash:list': () => Promise.resolve([]),
    'worktree:list': () => Promise.resolve([]),
    'submodule:list': () => Promise.resolve([])
  }
}));

const RevisionPicker = (
  await import('@renderer/components/dialogs/parts/RevisionPicker.vue')
).default;
const { useRepoStore } = await import('@renderer/stores/repo.js');

/** A `CommitSummary` shaped enough for `typedIsWorthShowing` to keep it. */
const summaryFor = (rev: string) => ({
  sha: `${rev}0000000000000000000000000000000000`.slice(0, 40),
  shortSha: rev,
  subject: `subject for ${rev}`,
  authorName: 'Someone',
  authorDate: 0,
  refs: []
});

/** Answer a held `describe`, for the revision text that asked it. */
async function land(rev: string): Promise<void>
{
  pending.get(rev)?.(summaryFor(rev));
  pending.delete(rev);
  await flushPromises();
}

function picker()
{
  useRepoStore().repo = {
    path: '/repo',
    name: 'repo',
    gitDir: '/repo/.git',
    branch: 'main',
    head: null,
    isBare: false,
    superprojectPath: null
  };
  return mount(RevisionPicker, { attachTo: document.body });
}

async function type(wrapper: ReturnType<typeof picker>, text: string): Promise<void>
{
  await wrapper.find('input').setValue(text);
  await flushPromises();
}

enableAutoUnmount(afterEach);

describe('RevisionPicker resolving what is typed', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
    pending.clear();
    asked.length = 0;
  });

  it('asks git for what was typed', async () =>
  {
    const wrapper = picker();

    await type(wrapper, 'abcd');
    await land('abcd');

    expect(asked).toContain('abcd');
    expect(wrapper.text()).toContain('subject for abcd');
  });

  /** One character matches most of a repository, so it is not worth a subprocess. */
  it('does not ask for a single character', async () =>
  {
    await type(picker(), 'a');

    expect(asked).toEqual([]);
  });

  /**
   * The race. Both keystrokes are in flight; the *older* one is answered second. Without a
   * guard the picker settles on it, offering a row for text that is no longer in the box.
   */
  it('ignores an answer a later keystroke has superseded', async () =>
  {
    const wrapper = picker();

    await type(wrapper, 'ab');
    await type(wrapper, 'abcd');

    // Both are outstanding: neither has been answered yet.
    expect(pending.has('ab')).toBe(true);
    expect(pending.has('abcd')).toBe(true);

    // The newer one lands first, then the older one overtakes it.
    await land('abcd');
    await land('ab');

    expect(wrapper.text()).toContain('subject for abcd');
    expect(wrapper.text()).not.toContain('subject for ab\n');
    expect(wrapper.text()).not.toContain('subject for ab ');
  });

  it('keeps the newest answer when the replies arrive in order', async () =>
  {
    const wrapper = picker();

    await type(wrapper, 'ab');
    await type(wrapper, 'abcd');
    await land('ab');
    await land('abcd');

    expect(wrapper.text()).toContain('subject for abcd');
  });
});
