/**
 * `git merge`, as `buildMergeArgs` builds it.
 *
 * Order matters as much as membership: this array is what the preview shows and what the
 * runner spawns, and `--squash` after the ref is a different command line from the same
 * flags in another order.
 */

import { describe, expect, it } from 'vitest';
import {
  buildMergeArgs,
  MERGE_STRATEGIES,
  type MergeOptions
} from '@renderer/model/args/merge.js';

const CASES: { name: string; options: MergeOptions; argv: string[] }[] = [
  {
    name: 'the plain merge, fast-forward allowed, nothing else asked for',
    options: { ref: 'feature' },
    argv: ['merge', '--no-edit', 'feature']
  },
  {
    name: 'always making a merge commit',
    options: { ref: 'feature', fastForward: false },
    argv: ['merge', '--no-ff', '--no-edit', 'feature']
  },
  {
    name: 'squashing',
    options: { ref: 'feature', squash: true },
    argv: ['merge', '--squash', '--no-edit', 'feature']
  },
  {
    name: 'stopping before the commit',
    options: { ref: 'feature', noCommit: true },
    argv: ['merge', '--no-commit', '--no-edit', 'feature']
  },
  {
    name: 'a non-default strategy',
    options: { ref: 'feature', strategy: 'resolve' },
    argv: ['merge', '--strategy=resolve', '--no-edit', 'feature']
  },
  {
    name: 'unrelated histories',
    options: { ref: 'other/main', allowUnrelatedHistories: true },
    argv: ['merge', '--allow-unrelated-histories', '--no-edit', 'other/main']
  },
  {
    name: 'a message file, -F and a path, never -m and the text',
    options: { ref: 'feature', messageFile: '/repo/.git/MERGE_MSG' },
    argv: ['merge', '-F', '/repo/.git/MERGE_MSG', '--no-edit', 'feature']
  },
  {
    name: 'a log summary of the merged commits',
    options: { ref: 'feature', logCount: 20 },
    argv: ['merge', '--log=20', '--no-edit', 'feature']
  },
  {
    name: 'everything at once, in flag order',
    options: {
      ref: 'feature',
      fastForward: false,
      strategy: 'ort',
      noCommit: true,
      allowUnrelatedHistories: true,
      messageFile: '/repo/.git/MERGE_MSG',
      logCount: 5
    },
    argv: [
      'merge',
      '--no-ff',
      '--strategy=ort',
      '--no-commit',
      '--allow-unrelated-histories',
      '-F',
      '/repo/.git/MERGE_MSG',
      '--log=5',
      '--no-edit',
      'feature'
    ]
  },
  {
    name: 'a tag merges like a branch',
    options: { ref: 'v1.0' },
    argv: ['merge', '--no-edit', 'v1.0']
  }
];

describe('buildMergeArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildMergeArgs(options)).toEqual(argv);
    });
  }

  it('always passes --no-edit', () =>
  {
    // Without it git opens $EDITOR in a terminal nobody is looking at, and the merge
    // reads as a hang.
    for (const { options } of CASES)
    {
      expect(buildMergeArgs(options)).toContain('--no-edit');
    }
  });

  it('puts --no-edit immediately before the ref, so nothing lands after the operand', () =>
  {
    const argv = buildMergeArgs({ ref: 'feature', noCommit: true, logCount: 3 });
    expect(argv.at(-1)).toBe('feature');
    expect(argv.at(-2)).toBe('--no-edit');
  });

  it('omits --log entirely for a count of zero or below', () =>
  {
    // `--log=0` is a valid flag meaning "no summary", but writing it says the option was
    // considered and switched off, which is not what an unticked box means.
    expect(buildMergeArgs({ ref: 'feature', logCount: 0 })).not.toContain('--log=0');
    expect(buildMergeArgs({ ref: 'feature', logCount: -1 }).join(' ')).not.toContain('--log');
  });

  it('omits the message file when there is none, rather than passing an empty -F', () =>
  {
    expect(buildMergeArgs({ ref: 'feature', messageFile: null })).not.toContain('-F');
  });

  it('never quotes: the argv is spawned, not shelled', () =>
  {
    expect(buildMergeArgs({ ref: 'feature', messageFile: '/a path/MERGE_MSG' })).toContain(
      '/a path/MERGE_MSG'
    );
  });
});

describe('MERGE_STRATEGIES', () =>
{
  it('is ort and resolve: the tail the plan cut is not offered', () =>
  {
    // octopus, ours and subtree are cut as options almost nobody uses, and `ort`
    // replaced `recursive` as git's default in 2.34.
    expect(MERGE_STRATEGIES.map((entry) => entry.strategy)).toEqual(['ort', 'resolve']);
  });

  it('builds every strategy it lists', () =>
  {
    for (const entry of MERGE_STRATEGIES)
    {
      expect(buildMergeArgs({ ref: 'feature', strategy: entry.strategy })).toContain(
        `--strategy=${entry.strategy}`
      );
    }
  });
});
