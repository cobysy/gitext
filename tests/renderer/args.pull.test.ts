/**
 * `git fetch` and `git pull`.
 *
 * The property worth testing is what sharing a builder buys: fetch and pull must agree
 * about what "fetch this branch from this remote" means, down to the `+` on the refspec.
 * Two builders would be two chances to drift.
 */

import { buildRemotePruneArgs } from '@renderer/model/args/remote.js';
import { describe, expect, it } from 'vitest';
import {
  buildFetchArgs,
  buildPullArgs,
  PULL_ACTIONS,
  type PullOptions
} from '@renderer/model/args/pull.js';

const CASES: { name: string; options: PullOptions; argv: string[] }[] = [
  {
    name: 'a plain pull',
    options: { action: 'merge', remote: 'origin' },
    argv: ['pull', '--progress', 'origin']
  },
  {
    name: 'pull with rebase',
    options: { action: 'rebase', remote: 'origin' },
    argv: ['pull', '--rebase', '--progress', 'origin']
  },
  {
    name: 'a plain fetch',
    options: { action: 'fetch', remote: 'origin' },
    argv: ['fetch', '--progress', 'origin']
  },
  {
    name: 'one branch, forced, the + is unconditional',
    options: { action: 'fetch', remote: 'origin', remoteBranch: 'feature' },
    argv: ['fetch', '--progress', 'origin', '+feature']
  },
  {
    name: 'one branch into a named local branch',
    options: {
      action: 'fetch',
      remote: 'origin',
      remoteBranch: 'feature',
      localBranch: 'my-feature'
    },
    argv: ['fetch', '--progress', 'origin', '+feature:refs/heads/my-feature']
  },
  {
    name: 'no tags',
    options: { action: 'fetch', remote: 'origin', tags: 'none' },
    argv: ['fetch', '--progress', 'origin', '--no-tags']
  },
  {
    name: 'all tags',
    options: { action: 'fetch', remote: 'origin', tags: 'all' },
    argv: ['fetch', '--progress', 'origin', '--tags']
  },
  {
    name: 'pruning, which is --prune --force',
    options: { action: 'fetch', remote: 'origin', prune: true },
    argv: ['fetch', '--progress', 'origin', '--prune', '--force']
  },
  {
    name: 'pruning tags too',
    options: { action: 'fetch', remote: 'origin', prune: true, pruneTags: true },
    argv: ['fetch', '--progress', 'origin', '--prune', '--force', '--prune-tags']
  },
  {
    name: 'unshallowing',
    options: { action: 'fetch', remote: 'origin', unshallow: true },
    argv: ['fetch', '--progress', 'origin', '--unshallow']
  }
];

describe('buildPullArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildPullArgs(options)).toEqual(argv);
    });
  }

  it('always passes --progress', () =>
  {
    // git suppresses progress when stdout is not a terminal, and this app reads that
    // output into the command log: so without it a long fetch prints nothing at all.
    for (const entry of PULL_ACTIONS)
    {
      expect(buildPullArgs({ action: entry.action, remote: 'origin' })).toContain('--progress');
    }
  });

  it('drops the local branch from a pull, which git refuses anyway', () =>
  {
    // `pull` writes into the checked-out branch, and git will not fetch into it.
    expect(
      buildPullArgs({
        action: 'merge',
        remote: 'origin',
        remoteBranch: 'feature',
        localBranch: 'mine'
      })
    ).toEqual(['pull', '--progress', 'origin', '+feature']);
  });

  it('keeps it for a fetch', () =>
  {
    expect(
      buildPullArgs({
        action: 'fetch',
        remote: 'origin',
        remoteBranch: 'feature',
        localBranch: 'mine'
      })
    ).toContain('+feature:refs/heads/mine');
  });
});

describe('buildFetchArgs', () =>
{
  it('is the same tail for both verbs', () =>
  {
    // The property the shared builder exists for: whatever "fetch this branch from this
    // remote" means, it means the same thing under both commands.
    const options = { remote: 'origin', remoteBranch: 'feature', tags: 'all' } as const;
    const tail = buildFetchArgs(options);
    expect(buildPullArgs({ ...options, action: 'fetch' })).toEqual([
      'fetch',
      '--progress',
      ...tail
    ]);
    expect(buildPullArgs({ ...options, action: 'merge' })).toEqual([
      'pull',
      '--progress',
      ...tail
    ]);
  });

  it('strips spaces out of the branch fields', () =>
  {
    // A branch name cannot contain one, and a typed field can.
    expect(buildFetchArgs({ remote: 'origin', remoteBranch: ' fea ture ' })).toEqual([
      'origin',
      '+feature'
    ]);
  });

  it('does not double the + on a refspec that already has one', () =>
  {
    expect(buildFetchArgs({ remote: 'origin', remoteBranch: '+feature' })).toEqual([
      'origin',
      '+feature'
    ]);
  });

  it('says nothing at all when nothing was asked for', () =>
  {
    // A bare `git fetch` is a legitimate command: it fetches the current branch's remote.
    expect(buildFetchArgs()).toEqual([]);
    expect(buildPullArgs({ action: 'fetch' })).toEqual(['fetch', '--progress']);
  });

  it('leaves the tag flags off by default, because neither means the default', () =>
  {
    // Without either flag git follows `remote.<name>.tagOpt`; writing `--no-tags` to mean
    // "the default" would change the behaviour.
    const argv = buildFetchArgs({ remote: 'origin' });
    expect(argv).not.toContain('--tags');
    expect(argv).not.toContain('--no-tags');
  });

  it('prunes when only tags were asked for, since --prune-tags needs it', () =>
  {
    expect(buildFetchArgs({ remote: 'origin', pruneTags: true })).toEqual([
      'origin',
      '--prune',
      '--force',
      '--prune-tags'
    ]);
  });
});

describe('buildRemotePruneArgs', () =>
{
  it('is what git suggests when a tracking ref is stale', () =>
  {
    expect(buildRemotePruneArgs('origin')).toEqual(['remote', 'prune', 'origin']);
  });
});
