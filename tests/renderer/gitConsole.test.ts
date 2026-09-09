/**
 * Which runs get a console window.
 *
 * The rule is read off the argv rather than set at each call site, because the call
 * sites are where it was got wrong: a push from the push dialog opened one and the same
 * push from Commit and Push did not, so a rejected push showed its error on a form with
 * its output nowhere. Anything that talks to a remote gets one wherever it is run from,
 * and so does a checkout, which rewrites the working tree and counts its way through it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    on: () => () =>
    {}
  }
}));

const { consoleWanted } = await import('@renderer/gitConsole.js');
const { useSettingsStore } = await import('@renderer/stores/settings.js');

const step = (...argv: string[]): { label: string; argv: string[] } => ({ label: 'x', argv });

beforeEach(() =>
{
  setActivePinia(createPinia());
});

describe('consoleWanted', () =>
{
  it('opens for anything over the network, with the setting off', () =>
  {
    for (const argv of [
      ['push'],
      ['push', 'origin', '--delete', 'v1.0'],
      ['fetch', '--progress', '--all'],
      ['pull', '--rebase'],
      ['remote', 'prune', 'origin']
    ])
    {
      expect(consoleWanted([step(...argv)], undefined), argv.join(' ')).toBe(true);
    }
  });

  it('opens for a checkout, which rewrites the working tree', () =>
  {
    for (const argv of [
      ['checkout', 'topic'],
      ['checkout', '--merge', 'topic'],
      ['checkout', '-b', 'topic', 'origin/topic'],
      ['checkout', '--orphan', 'fresh']
    ])
    {
      expect(consoleWanted([step(...argv)], undefined), argv.join(' ')).toBe(true);
    }
  });

  it('stays shut for a checkout that names paths, which restores them', () =>
  {
    // Discarding one file's changes from the staging list, and taking one side of a
    // conflict: both are `checkout`, neither is slow, and a window each would be a
    // window per file.
    for (const argv of [
      ['checkout', 'HEAD', '--', 'src/app.ts'],
      ['checkout', '--ours', '--', 'src/app.ts'],
      ['checkout', '--', '.']
    ])
    {
      expect(consoleWanted([step(...argv)], undefined), argv.join(' ')).toBe(false);
    }
  });

  it('stays shut for local work, with the setting off', () =>
  {
    for (const argv of [['merge', 'topic'], ['commit', '-m', 'x'], ['remote', 'add', 'o', 'url']])
    {
      expect(consoleWanted([step(...argv)], undefined), argv.join(' ')).toBe(false);
    }
  });

  it('opens for local work once the setting is on', () =>
  {
    useSettingsStore().settings.streamLiveOutput = true;
    expect(consoleWanted([step('merge', 'topic')], undefined)).toBe(true);
  });

  it('takes an explicit answer over both: `gc` never leaves the machine', () =>
  {
    expect(consoleWanted([step('gc')], true)).toBe(true);
    expect(consoleWanted([step('push')], false)).toBe(false);
  });

  it('opens when a checkout is one step of a plan that starts by stashing', () =>
  {
    // A checkout with local changes in the way is a stash and then the checkout: the
    // stash alone would not open one, and the whole operation is watched because the
    // checkout is.
    expect(
      consoleWanted([step('stash', 'push', '-u'), step('checkout', 'topic')], undefined)
    ).toBe(true);
  });

  it('opens when any step of an operation is a network one', () =>
  {
    // Create Tag is a tag and then, sometimes, a push: the push is what decides.
    expect(consoleWanted([step('tag', 'v1'), step('push', 'origin', 'v1')], undefined)).toBe(true);
  });
});
