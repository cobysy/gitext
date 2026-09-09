/**
 * `git push`, as `buildPushArgs` / `buildPushAllArgs` / `buildPushTagArgs` build it.
 *
 * The case that matters most is the first: `--force` and `--force-with-lease` are a
 * one-of, not two flags, because git takes the last one on the line: so a form with two
 * checkboxes produces a command whose meaning depends on the order the code happened to
 * write them in, and one of the two silently destroys work.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPushAllArgs,
  buildPushArgs,
  buildPushTagArgs,
  FORCE_MODES,
  isRejectedPush,
  REJECTION_REMEDIES,
  rejectionRemedy,
  type PushOptions
} from '@renderer/model/args/push.js';

const CASES: { name: string; options: PushOptions; argv: string[] }[] = [
  {
    name: 'a plain push',
    options: { remote: 'origin', from: 'main' },
    argv: ['push', '--progress', 'origin', 'main']
  },
  {
    name: 'setting the upstream',
    options: { remote: 'origin', from: 'main', setUpstream: true },
    argv: ['push', '-u', '--progress', 'origin', 'main']
  },
  {
    name: 'force with lease',
    options: { remote: 'origin', from: 'main', force: 'lease' },
    argv: ['push', '--force-with-lease', '--progress', 'origin', 'main']
  },
  {
    name: 'plain force',
    options: { remote: 'origin', from: 'main', force: 'force' },
    argv: ['push', '--force', '--progress', 'origin', 'main']
  },
  {
    name: 'a different name on the remote, the : in a refspec',
    options: { remote: 'origin', from: 'main', to: 'trunk' },
    argv: ['push', '--progress', 'origin', 'main:trunk']
  },
  {
    name: 'the same name on both sides needs no refspec',
    options: { remote: 'origin', from: 'main', to: 'main' },
    argv: ['push', '--progress', 'origin', 'main']
  },
  {
    name: 'refusing when a submodule commit is unpushed',
    options: { remote: 'origin', from: 'main', submodules: 'check' },
    argv: ['push', '--recurse-submodules=check', '--progress', 'origin', 'main']
  },
  {
    name: 'pushing the submodules too',
    options: { remote: 'origin', from: 'main', submodules: 'on-demand' },
    argv: ['push', '--recurse-submodules=on-demand', '--progress', 'origin', 'main']
  },
  {
    name: 'everything at once, in flag order',
    options: {
      remote: 'origin',
      from: 'main',
      to: 'trunk',
      force: 'lease',
      setUpstream: true,
      submodules: 'on-demand'
    },
    argv: [
      'push',
      '--force-with-lease',
      '-u',
      '--recurse-submodules=on-demand',
      '--progress',
      'origin',
      'main:trunk'
    ]
  }
];

describe('buildPushArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildPushArgs(options)).toEqual(argv);
    });
  }

  it('never writes both force flags', () =>
  {
    // git takes the last one on the line, so a command carrying both means whichever this
    // file wrote second, which is exactly the ambiguity the one-of exists to remove.
    for (const entry of FORCE_MODES)
    {
      const argv = buildPushArgs({ remote: 'origin', from: 'main', force: entry.mode });
      const flags = argv.filter((arg) => arg === '--force' || arg === '--force-with-lease');
      expect(flags.length).toBeLessThanOrEqual(1);
    }
  });

  it('sends HEAD when a destination is named without a source', () =>
  {
    // `git push origin :main` is git's syntax for *deleting* `main`, which is not what an
    // empty source field means in a dialog.
    expect(buildPushArgs({ remote: 'origin', from: '', to: 'main' })).toEqual([
      'push',
      '--progress',
      'origin',
      'HEAD:main'
    ]);
  });

  it('always passes --progress', () =>
  {
    expect(buildPushArgs({ remote: 'origin', from: 'main' })).toContain('--progress');
  });
});

describe('buildPushAllArgs', () =>
{
  it('pushes every branch', () =>
  {
    expect(buildPushAllArgs({ remote: 'origin' })).toEqual([
      'push',
      '--progress',
      '--all',
      'origin'
    ]);
  });

  it('puts --all before the remote', () =>
  {
    const argv = buildPushAllArgs({ remote: 'origin', force: 'lease' });
    expect(argv.indexOf('--all')).toBeLessThan(argv.indexOf('origin'));
  });
});

describe('buildPushTagArgs', () =>
{
  it('uses the `tag` keyword rather than a bare name', () =>
  {
    // A tag and a branch may share a name; `git push origin v1.0` would push whichever
    // git resolved first.
    expect(buildPushTagArgs({ remote: 'origin', tag: 'v1.0' })).toEqual([
      'push',
      '--progress',
      'origin',
      'tag',
      'v1.0'
    ]);
  });

  it('pushes every tag with --tags', () =>
  {
    expect(buildPushTagArgs({ remote: 'origin', all: true })).toEqual([
      'push',
      '--progress',
      'origin',
      '--tags'
    ]);
  });

  it('builds nothing without a tag or --tags', () =>
  {
    // An empty argv, in a form whose button is disabled.
    expect(buildPushTagArgs({ remote: 'origin' })).toEqual([]);
  });

  it('strips spaces out of the tag name', () =>
  {
    expect(buildPushTagArgs({ remote: 'origin', tag: 'v 1.0' })).toContain('v1.0');
  });
});

describe('isRejectedPush', () =>
{
  it.each([
    ' ! [rejected]        main -> main (fetch first)',
    'Updates were rejected because the remote contains work that you do not have locally.',
    'error: failed to push some refs, non-fast-forward'
  ])('recognises %s', (stderr) =>
  {
    expect(isRejectedPush(stderr)).toBe(true);
  });

  it('does not mistake an authentication failure for a rejection', () =>
  {
    // Offering "pull with rebase" to somebody whose credentials are wrong would send them
    // round a loop that cannot end.
    expect(isRejectedPush('fatal: Authentication failed for https://example.com')).toBe(false);
  });

  it('does not mistake a missing remote for a rejection', () =>
  {
    expect(isRejectedPush("fatal: 'nowhere' does not appear to be a git repository")).toBe(
      false
    );
  });
});

describe('REJECTION_REMEDIES', () =>
{
  it('offers the three things that resolve a rejection', () =>
  {
    expect(REJECTION_REMEDIES.map((entry) => entry.remedy)).toEqual([
      'pull-rebase',
      'pull-merge',
      'force-lease'
    ]);
  });

  it('marks only the forcing one as destructive', () =>
  {
    expect(REJECTION_REMEDIES.filter((entry) => entry.danger).map((e) => e.remedy)).toEqual([
      'force-lease'
    ]);
  });

  it('looks one up by name', () =>
  {
    expect(rejectionRemedy('pull-merge').label).toBe('Pull with merge, then push');
    expect(rejectionRemedy('force-lease').danger).toBe(true);
  });

  // The dialog labels its confirming button from this, so a miss must be loud rather than
  // silently falling back to whichever entry happens to be first.
  it('refuses a remedy it does not have', () =>
  {
    expect(() => rejectionRemedy('pull-nothing' as never)).toThrow(/Unknown rejection remedy/);
  });
});
