/**
 * `git rebase`, as `buildRebaseArgs` builds it.
 *
 * The structure of that builder is not flat: the date options *replace* the interactive
 * block rather than sitting beside it, and the cases below are mostly about that, because
 * it is the part a reimplementation gets wrong by flattening.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRebaseArgs,
  buildRebaseStepArgs,
  REBASE_DATES,
  REBASE_STEPS,
  type RebaseOptions
} from '@renderer/model/args/rebase.js';

const CASES: { name: string; options: RebaseOptions; argv: string[] }[] = [
  {
    name: 'the plain rebase',
    options: { upstream: 'main' },
    argv: ['rebase', 'main']
  },
  {
    name: 'interactive always writes one of the autosquash pair alongside -i',
    options: { upstream: 'main', interactive: true },
    argv: ['rebase', '-i', '--no-autosquash', 'main']
  },
  {
    name: 'interactive with autosquash',
    options: { upstream: 'main', interactive: true, autosquash: true },
    argv: ['rebase', '-i', '--autosquash', 'main']
  },
  {
    name: 'autosquash on its own does nothing, it is an interactive-only flag',
    options: { upstream: 'main', autosquash: true },
    argv: ['rebase', 'main']
  },
  {
    name: 'replaying merges rather than flattening them',
    options: { upstream: 'main', rebaseMerges: true },
    argv: ['rebase', '--rebase-merges', 'main']
  },
  {
    name: 'autostash',
    options: { upstream: 'main', autostash: true },
    argv: ['rebase', '--autostash', 'main']
  },
  {
    name: 'update-refs on',
    options: { upstream: 'main', updateRefs: true },
    argv: ['rebase', '--update-refs', 'main']
  },
  {
    name: 'update-refs explicitly off',
    options: { upstream: 'main', updateRefs: false },
    argv: ['rebase', '--no-update-refs', 'main']
  },
  {
    name: 'update-refs left to the config says nothing at all',
    options: { upstream: 'main', updateRefs: null },
    argv: ['rebase', 'main']
  },
  {
    name: 'a range',
    options: { upstream: 'main', from: 'HEAD~5', onto: 'release' },
    argv: ['rebase', '--onto', 'release', 'HEAD~5']
  },
  {
    name: 'a range on a named branch',
    options: { upstream: 'main', from: 'HEAD~5', onto: 'release', branch: 'feature' },
    argv: ['rebase', '--onto', 'release', 'HEAD~5', 'feature']
  },
  {
    name: 'rebasing a branch other than the checked-out one',
    options: { upstream: 'main', branch: 'feature' },
    argv: ['rebase', 'main', 'feature']
  },
  {
    name: 'ignore-date',
    options: { upstream: 'main', dates: 'ignore' },
    argv: ['rebase', '--ignore-date', 'main']
  },
  {
    name: 'committer-date-is-author-date',
    options: { upstream: 'main', dates: 'committer-is-author' },
    argv: ['rebase', '--committer-date-is-author-date', 'main']
  }
];

describe('buildRebaseArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildRebaseArgs(options)).toEqual(argv);
    });
  }

  describe('the date options replace the interactive block, they do not join it', () =>
  {
    it('drops -i under --ignore-date', () =>
    {
      // `-i` belongs inside the `else` of the date branch. Flattened, git takes both and
      // the rebase is interactive when the dialog said it was doing something else.
      const argv = buildRebaseArgs({ upstream: 'main', dates: 'ignore', interactive: true });
      expect(argv).not.toContain('-i');
      expect(argv).toContain('--ignore-date');
    });

    it('drops --rebase-merges too', () =>
    {
      const argv = buildRebaseArgs({
        upstream: 'main',
        dates: 'committer-is-author',
        rebaseMerges: true
      });
      expect(argv).not.toContain('--rebase-merges');
    });

    it('never writes both date flags', () =>
    {
      for (const entry of REBASE_DATES)
      {
        const argv = buildRebaseArgs({ upstream: 'main', dates: entry.value });
        const dateFlags = argv.filter(
          (arg) => arg === '--ignore-date' || arg === '--committer-date-is-author-date'
        );
        expect(dateFlags.length).toBeLessThanOrEqual(1);
      }
    });
  });

  it('keeps autostash and update-refs outside the date branch', () =>
  {
    // Both are added after the if/else, so they survive a date option.
    const argv = buildRebaseArgs({
      upstream: 'main',
      dates: 'ignore',
      autostash: true,
      updateRefs: true
    });
    expect(argv).toEqual([
      'rebase',
      '--ignore-date',
      '--update-refs',
      '--autostash',
      'main'
    ]);
  });

  it('puts the range start where the upstream would have been', () =>
  {
    // `rebase --onto X A B` replays A..B onto X. Passing the upstream *and* the range
    // start would replay a different set of commits and still exit 0.
    const argv = buildRebaseArgs({ upstream: 'main', from: 'HEAD~3', onto: 'release' });
    expect(argv).not.toContain('main');
    expect(argv.at(-1)).toBe('HEAD~3');
  });

  it('never quotes: the argv is spawned, not shelled', () =>
  {
    expect(buildRebaseArgs({ upstream: 'feature/two words' })).toEqual([
      'rebase',
      'feature/two words'
    ]);
  });
});

describe('buildRebaseStepArgs', () =>
{
  it.each(REBASE_STEPS.map((entry) => entry.step))('builds --%s', (step) =>
  {
    expect(buildRebaseStepArgs(step)).toEqual(['rebase', `--${step}`]);
  });

  it('offers continue, skip, edit-todo and abort', () =>
  {
    expect(REBASE_STEPS.map((entry) => entry.step)).toEqual([
      'continue',
      'skip',
      'edit-todo',
      'abort'
    ]);
  });

  it('marks only abort as destructive', () =>
  {
    // Continue and skip move forwards; only abort throws away what has been replayed.
    expect(REBASE_STEPS.filter((entry) => entry.danger).map((entry) => entry.step)).toEqual([
      'abort'
    ]);
  });
});
