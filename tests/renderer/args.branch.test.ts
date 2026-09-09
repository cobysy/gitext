/**
 * Creating a branch, as `buildCreateBranchArgs` and its siblings build it.
 *
 * The table is the test. The case worth reading twice is the last group: clearing an
 * orphan's working directory is a *second command*, not a flag, and a builder that folded
 * it into the checkout would produce something git rejects outright.
 */

import { describe, expect, it } from 'vitest';
import {
  buildClearWorkingDirectoryArgs,
  buildCreateBranchArgs,
  buildCreateBranchSteps,
  buildSetUpstreamArgs,
  buildUnsetUpstreamArgs,
  buildUpdateRefArgs,
  type CreateBranchOptions
} from '@renderer/model/args/branch.js';

const CASES: { name: string; options: CreateBranchOptions; argv: string[] }[] = [
  {
    name: 'created without moving to it',
    options: { name: 'feature', startPoint: 'main' },
    argv: ['branch', 'feature', 'main']
  },
  {
    name: 'created and checked out, a different git command, not a flag on branch',
    options: { name: 'feature', startPoint: 'main', checkout: true },
    argv: ['checkout', '-b', 'feature', 'main']
  },
  {
    name: 'at a SHA',
    options: { name: 'feature', startPoint: '4a2b1c9', checkout: true },
    argv: ['checkout', '-b', 'feature', '4a2b1c9']
  },
  {
    name: 'with no starting point named, git uses HEAD',
    options: { name: 'feature' },
    argv: ['branch', 'feature']
  },
  {
    name: 'the name is trimmed',
    options: { name: '  feature  ', startPoint: 'main' },
    argv: ['branch', 'feature', 'main']
  },
  {
    name: 'an orphan',
    options: { name: 'docs', startPoint: 'main', orphan: true },
    argv: ['checkout', '--orphan', 'docs', 'main']
  },
  {
    name: 'an orphan in a repository with no commits, nothing to start from',
    options: { name: 'main', orphan: true },
    argv: ['checkout', '--orphan', 'main']
  },
  {
    name: 'an orphan ignores the checkout flag: it is always a checkout',
    options: { name: 'docs', startPoint: 'main', orphan: true, checkout: false },
    argv: ['checkout', '--orphan', 'docs', 'main']
  }
];

describe('buildCreateBranchArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildCreateBranchArgs(options)).toEqual(argv);
    });
  }

  it('never quotes: the argv is spawned, not shelled', () =>
  {
    expect(buildCreateBranchArgs({ name: 'feature/two words' })).toEqual([
      'branch',
      'feature/two words'
    ]);
  });
});

describe('the orphan clear', () =>
{
  it('is `rm -r --force .`', () =>
  {
    expect(buildClearWorkingDirectoryArgs()).toEqual(['rm', '-r', '--force', '.']);
  });

  it('is a second step, so its failure is named separately', () =>
  {
    expect(
      buildCreateBranchSteps({
        name: 'docs',
        startPoint: 'main',
        orphan: true,
        clearWorkingDirectory: true
      })
    ).toEqual([
      { label: 'Creating the branch', argv: ['checkout', '--orphan', 'docs', 'main'] },
      { label: 'Emptying the working directory', argv: ['rm', '-r', '--force', '.'] }
    ]);
  });

  it('does not run for a branch that is not an orphan', () =>
  {
    // The box is disabled there, but a plan that emptied the working directory because a
    // stale tick survived a mode change would be unrecoverable, so the builder refuses too.
    const argvs = buildCreateBranchSteps({
      name: 'feature',
      startPoint: 'main',
      checkout: true,
      clearWorkingDirectory: true
    }).map((step) => step.argv);
    expect(argvs).toEqual([['checkout', '-b', 'feature', 'main']]);
  });

  it('does not run for an orphan when the box is not ticked', () =>
  {
    expect(buildCreateBranchSteps({ name: 'docs', orphan: true })).toHaveLength(1);
  });

});

describe('an incomplete form', () =>
{
  it('plans nothing without a name', () =>
  {
    expect(buildCreateBranchSteps({ name: '   ', startPoint: 'main' })).toEqual([]);
  });
});

/**
 * Moving a branch that is not checked out.
 *
 * `update-ref` rather than `reset`, and the complete ref name rather than the short one:
 * both are the whole content of `buildUpdateRefArgs`, and both are the kind of thing that
 * looks right and does something else entirely if you get it wrong.
 */
describe('buildUpdateRefArgs', () =>
{
  it('writes the ref and nothing else', () =>
  {
    expect(buildUpdateRefArgs('refs/heads/feature', '4a2b1c9')).toEqual([
      'update-ref',
      'refs/heads/feature',
      '4a2b1c9'
    ]);
  });

  it('is not a reset: nothing here touches the index or the working directory', () =>
  {
    // `git reset` moves HEAD's branch and takes the working tree with it; there is no form
    // of it that moves some other branch, which is why this command exists at all.
    expect(buildUpdateRefArgs('refs/heads/feature', 'HEAD')[0]).toBe('update-ref');
  });

  it('takes the complete ref name, because a short one creates a file', () =>
  {
    // `git update-ref feature <sha>` writes `.git/feature`, leaving the branch untouched
    // and the repository with a stray ref nobody asked for.
    const argv = buildUpdateRefArgs('refs/heads/feature', '4a2b1c9');
    expect(argv[1]).toMatch(/^refs\/heads\//);
  });
});

/** What a branch tracks, and the two ways to say it. */
describe('buildSetUpstreamArgs', () =>
{
  it('names the upstream on the flag and the branch as the argument', () =>
  {
    expect(buildSetUpstreamArgs('feature', 'origin/feature')).toEqual([
      'branch',
      '--set-upstream-to=origin/feature',
      'feature'
    ]);
  });

  it('names the branch explicitly rather than leaving git to assume the current one', () =>
  {
    // The operand is the panel row that was right-clicked, which is often not the branch
    // that is checked out. Omitting it would silently retarget whatever HEAD is on.
    expect(buildSetUpstreamArgs('other', 'origin/main').at(-1)).toBe('other');
  });

  it('trims, so the preview shows what runs', () =>
  {
    expect(buildSetUpstreamArgs('  feature  ', '  origin/main  ')).toEqual([
      'branch',
      '--set-upstream-to=origin/main',
      'feature'
    ]);
  });

  it('builds nothing without both halves', () =>
  {
    expect(buildSetUpstreamArgs('feature', '   ')).toEqual([]);
    expect(buildSetUpstreamArgs('', 'origin/main')).toEqual([]);
  });
});

describe('buildUnsetUpstreamArgs', () =>
{
  it('clears what the branch tracks', () =>
  {
    expect(buildUnsetUpstreamArgs('feature')).toEqual(['branch', '--unset-upstream', 'feature']);
  });

  it('builds nothing without a branch', () =>
  {
    expect(buildUnsetUpstreamArgs('  ')).toEqual([]);
  });
});
