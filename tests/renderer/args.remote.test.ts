/**
 * `git remote` argv, and the plan that turns an edited row into commands.
 *
 * The plan is the half worth testing. Renaming a remote *and* changing its URL is two
 * commands whose order matters: `set-url` takes a remote by name, so writing the URL
 * first writes it to a name that is about to change, and the old dialog could not do
 * either, so nothing here had ever been checked.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRemoteAddArgs,
  buildRemoteClearPushUrlArgs,
  buildRemotePruneArgs,
  buildRemoteRemoveArgs,
  buildRemoteRenameArgs,
  buildRemoteSaveSteps,
  buildRemoteSetUrlArgs,
  draftFromRemote,
  type RemoteDraft
} from '@renderer/model/args/remote.js';

const origin: RemoteDraft = {
  name: 'origin',
  fetchUrl: 'https://example.com/a.git',
  pushUrl: ''
};

describe('the single commands', () =>
{
  it('add', () =>
  {
    expect(buildRemoteAddArgs('upstream', 'https://example.com/b.git')).toEqual([
      'remote',
      'add',
      'upstream',
      'https://example.com/b.git'
    ]);
  });

  it('add needs both halves', () =>
  {
    expect(buildRemoteAddArgs('', 'https://example.com/b.git')).toEqual([]);
    expect(buildRemoteAddArgs('upstream', '  ')).toEqual([]);
  });

  it('rename', () =>
  {
    expect(buildRemoteRenameArgs('origin', 'upstream')).toEqual([
      'remote',
      'rename',
      'origin',
      'upstream'
    ]);
  });

  it('rename to the same name is not a command', () =>
  {
    expect(buildRemoteRenameArgs('origin', 'origin')).toEqual([]);
  });

  it('remove, spelled the long way', () =>
  {
    // `rm` works too, but the log reads better for someone who has not memorised git's
    // abbreviations.
    expect(buildRemoteRemoveArgs('origin')).toEqual(['remote', 'remove', 'origin']);
  });

  it('set-url, and set-url --push', () =>
  {
    expect(buildRemoteSetUrlArgs('origin', 'git@example.com:a.git')).toEqual([
      'remote',
      'set-url',
      'origin',
      'git@example.com:a.git'
    ]);
    expect(
      buildRemoteSetUrlArgs('origin', 'git@example.com:a.git', { push: true })
    ).toEqual(['remote', 'set-url', '--push', 'origin', 'git@example.com:a.git']);
  });

  it('clearing a push URL does not need to know the old one', () =>
  {
    expect(buildRemoteClearPushUrlArgs('origin')).toEqual([
      'config',
      '--unset',
      'remote.origin.pushurl'
    ]);
  });

  it('prune', () =>
  {
    expect(buildRemotePruneArgs('origin')).toEqual(['remote', 'prune', 'origin']);
  });
});

describe('draftFromRemote', () =>
{
  it('treats a push URL equal to the fetch URL as unset', () =>
  {
    // `RemoteEntry.pushUrl` falls back to the fetch URL because that is what git does:
    // but git has stored nothing, and echoing it into the form would write a `pushurl`
    // nobody asked for as soon as anything else on the row changed.
    expect(
      draftFromRemote({ name: 'origin', fetchUrl: 'https://x/a.git', pushUrl: 'https://x/a.git' })
    ).toEqual({ name: 'origin', fetchUrl: 'https://x/a.git', pushUrl: '' });
  });

  it('keeps a push URL that genuinely differs', () =>
  {
    expect(
      draftFromRemote({ name: 'origin', fetchUrl: 'https://x/a.git', pushUrl: 'git@x:a.git' })
        .pushUrl
    ).toBe('git@x:a.git');
  });
});

describe('buildRemoteSaveSteps', () =>
{
  it('is empty when nothing changed', () =>
  {
    expect(buildRemoteSaveSteps(origin, { ...origin })).toEqual([]);
  });

  it('a URL change alone is one command', () =>
  {
    const steps = buildRemoteSaveSteps(origin, { ...origin, fetchUrl: 'git@example.com:a.git' });
    expect(steps.map((step) => step.argv)).toEqual([
      ['remote', 'set-url', 'origin', 'git@example.com:a.git']
    ]);
  });

  it('renames first, and every later command names the new name', () =>
  {
    const steps = buildRemoteSaveSteps(origin, {
      name: 'upstream',
      fetchUrl: 'git@example.com:a.git',
      pushUrl: 'git@example.com:fork.git'
    });
    expect(steps.map((step) => step.argv)).toEqual([
      ['remote', 'rename', 'origin', 'upstream'],
      ['remote', 'set-url', 'upstream', 'git@example.com:a.git'],
      ['remote', 'set-url', '--push', 'upstream', 'git@example.com:fork.git']
    ]);
  });

  it('emptying the push box unsets it rather than writing an empty URL', () =>
  {
    const withPush: RemoteDraft = { ...origin, pushUrl: 'git@example.com:a.git' };
    expect(buildRemoteSaveSteps(withPush, { ...withPush, pushUrl: '' })[0]?.argv).toEqual([
      'config',
      '--unset',
      'remote.origin.pushurl'
    ]);
  });

  it('never writes an empty fetch URL', () =>
  {
    expect(buildRemoteSaveSteps(origin, { ...origin, fetchUrl: '' })).toEqual([]);
  });

  it('is empty when the name has been cleared: there is nothing to name', () =>
  {
    expect(buildRemoteSaveSteps(origin, { ...origin, name: '  ' })).toEqual([]);
  });

  it('labels every step with the sentence its failure belongs to', () =>
  {
    const steps = buildRemoteSaveSteps(origin, { ...origin, name: 'upstream' });
    expect(steps[0]?.label).toContain('origin');
    expect(steps[0]?.label).toContain('upstream');
  });
});
