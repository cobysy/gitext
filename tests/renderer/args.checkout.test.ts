import { describe, expect, it } from 'vitest';
import {
  buildAutoStashArgs,
  buildCheckoutArgs,
  buildCheckoutSteps,
  LOCAL_CHANGE_BRANCHES,
  buildFetchBranchArgs,
  buildStashPopArgs,
  checkoutCreatesBranch,
  type CheckoutOptions,
  type NewBranchMode
} from '@renderer/model/args/checkout.js';

/**
 * The table is the test.
 *
 * Every row is a case for what `git checkout` gets built from, which flags each
 * combination produces, and in which order. Order matters as much as membership: the
 * preview shows this array and the runner spawns it, so a table that agreed on the set
 * but not the sequence would be a command log that does not read like the command that
 * ran.
 */
const CASES: { name: string; options: CheckoutOptions; argv: string[] }[] = [
  {
    name: 'a plain branch checkout',
    options: { ref: 'main' },
    argv: ['checkout', 'main']
  },
  {
    name: 'local changes: merge them into the branch being checked out',
    options: { ref: 'main', localChanges: 'merge' },
    argv: ['checkout', '--merge', 'main']
  },
  {
    name: 'local changes: throw them away',
    options: { ref: 'main', localChanges: 'reset' },
    argv: ['checkout', '--force', 'main']
  },
  {
    name: "local changes: don't change is the absence of a flag, not a flag",
    options: { ref: 'main', localChanges: 'none' },
    argv: ['checkout', 'main']
  },
  {
    name: 'a remote branch, checked out detached, no local branch at all',
    options: { ref: 'origin/feature', remote: true, newBranchMode: 'none' },
    argv: ['checkout', 'origin/feature']
  },
  {
    name: 'a remote branch, creating a tracking local branch',
    options: {
      ref: 'origin/feature',
      remote: true,
      newBranchMode: 'create',
      newBranchName: 'feature'
    },
    argv: ['checkout', '-b', 'feature', '--track', 'origin/feature']
  },
  {
    name: 'a remote branch, resetting the local branch that already exists',
    options: {
      ref: 'origin/feature',
      remote: true,
      newBranchMode: 'reset',
      newBranchName: 'feature'
    },
    argv: ['checkout', '-B', 'feature', 'origin/feature']
  },
  {
    name: 'the new-branch modes apply to a remote branch only',
    options: { ref: 'feature', remote: false, newBranchMode: 'create', newBranchName: 'other' },
    argv: ['checkout', 'feature']
  },
  {
    name: 'local changes and a new tracking branch together, in flag order',
    options: {
      ref: 'origin/feature',
      remote: true,
      localChanges: 'merge',
      newBranchMode: 'create',
      newBranchName: 'feature'
    },
    argv: ['checkout', '--merge', '-b', 'feature', '--track', 'origin/feature']
  },
  {
    name: 'forcing over local changes while resetting the local branch',
    options: {
      ref: 'origin/feature',
      remote: true,
      localChanges: 'reset',
      newBranchMode: 'reset',
      newBranchName: 'feature'
    },
    argv: ['checkout', '--force', '-B', 'feature', 'origin/feature']
  },
  {
    name: 'a mode with no name yet previews the checkout without inventing a branch',
    options: { ref: 'origin/feature', remote: true, newBranchMode: 'create' },
    argv: ['checkout', 'origin/feature']
  },
  {
    name: 'a SHA is a ref like any other',
    options: { ref: '4a2b1c9' },
    argv: ['checkout', '4a2b1c9']
  },
  {
    // Checking out a revision needs no argv module of its own: it is this same builder
    // with `localChanges: 'reset'` forcing `--force`.
    name: 'a revision checkout forcing over local changes',
    options: { ref: '4a2b1c9', localChanges: 'reset' },
    argv: ['checkout', '--force', '4a2b1c9']
  },
  {
    name: 'a revision checkout merging local changes across',
    options: { ref: '4a2b1c9', localChanges: 'merge' },
    argv: ['checkout', '--merge', '4a2b1c9']
  },
  {
    name: 'a tag checks out the same way a SHA does, detached, with no -b',
    options: { ref: 'v1.0', newBranchMode: 'create', newBranchName: 'from-tag' },
    argv: ['checkout', 'v1.0']
  }
];

describe('buildCheckoutArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildCheckoutArgs(options)).toEqual(argv);
    });
  }

  it('never quotes or escapes: the argv is spawned, not shelled', () =>
  {
    // A branch name with a space is why `runGit` takes an array. Quoting here would put
    // the quotes *in* the ref name and the checkout would fail on a branch that exists.
    expect(buildCheckoutArgs({ ref: 'feature/two words' })).toEqual([
      'checkout',
      'feature/two words'
    ]);
  });
});

/**
 * The stash round trip: the half of the checkout dialog that is not a flag.
 *
 * A stash before the checkout and a pop after it run conditionally and separately: the
 * plan is what runs unconditionally, and the pop is not in it.
 */
describe('the stash round trip', () =>
{
  it('stashes with `push`, not the deprecated `save` or the bare form', () =>
  {
    expect(buildAutoStashArgs()).toEqual(['stash', 'push']);
  });

  it('sweeps untracked files in only when asked', () =>
  {
    expect(buildAutoStashArgs(true)).toEqual(['stash', 'push', '-u']);
  });

  it('pops with no arguments: the top of the stack is the one just taken', () =>
  {
    expect(buildStashPopArgs()).toEqual(['stash', 'pop']);
  });

  it('is one step when nothing has to move out of the way', () =>
  {
    expect(buildCheckoutSteps({ ref: 'main' })).toEqual([
      { label: 'Checking out', argv: ['checkout', 'main'] }
    ]);
  });

  it('puts the stash in front of the checkout, each named for its own failure', () =>
  {
    expect(buildCheckoutSteps({ ref: 'main', stash: true, stashUntracked: true })).toEqual([
      { label: 'Stashing your changes', argv: ['stash', 'push', '-u'] },
      { label: 'Checking out', argv: ['checkout', 'main'] }
    ]);
  });

  it('leaves the pop out: it runs only if the user says yes afterwards', () =>
  {
    const argvs = buildCheckoutSteps({ ref: 'main', stash: true }).map((s) => s.argv);
    expect(argvs).not.toContainEqual(['stash', 'pop']);
  });

  it('never carries a local-changes flag alongside the stash', () =>
  {
    // Stashing *is* the answer to the dirty tree; `--merge` or `--force` on top of it
    // would be answering the same question twice. The dialog maps 'stash' to 'none'
    // before it gets here, and this pins that the builder does not reintroduce one.
    const steps = buildCheckoutSteps({ ref: 'main', stash: true, localChanges: 'none' });
    expect(steps.map((step) => step.argv)).toEqual([
      ['stash', 'push'],
      ['checkout', 'main']
    ]);
  });

});

/**
 * The fetch the panel's remote-branch rows run before their dialog opens.
 *
 * Fetch and checkout are two operations, so this is its own argv rather than a step
 * inside a checkout plan.
 */
describe('buildFetchBranchArgs', () =>
{
  it('names the remote and the branch, and nothing else', () =>
  {
    expect(buildFetchBranchArgs({ remote: 'origin', branch: 'feature/login' })).toEqual([
      'fetch',
      '--progress',
      'origin',
      'feature/login'
    ]);
  });

  /**
   * No `+`, and no `:refs/heads/…`.
   *
   * The pull dialog's refspec builder writes `+<branch>:refs/heads/<local>` because it can
   * be asked to fetch into a *named local branch*, and the `+` forces that past a
   * non-fast-forward. This row has no local branch in it: it brings the tracking ref up to
   * date and stops, and git updates `refs/remotes/origin/x` opportunistically because the
   * refspec matches the remote's configured one.
   */
  it('is a plain refspec: no force marker, no local branch', () =>
  {
    const argv = buildFetchBranchArgs({ remote: 'origin', branch: 'x' });
    expect(argv.some((arg) => arg.startsWith('+') || arg.includes(':'))).toBe(false);
  });
});

describe('putting the local changes on a branch', () =>
{
  it('parks the work and still checks out what was asked for', () =>
  {
    const steps = buildCheckoutSteps({
      ref: 'main',
      branch: { mode: 'commit', name: 'wip/docs', from: 'docs' }
    });

    expect(steps.map((step) => step.argv)).toEqual([
      ['checkout', '-b', 'wip/docs'],
      ['add', '-A'],
      ['commit', '-m', 'WIP on docs'],
      ['checkout', 'main']
    ]);
  });

  it('names the WIP commit after nothing in particular on a detached HEAD', () =>
  {
    const steps = buildCheckoutSteps({
      ref: 'main',
      branch: { mode: 'commit', name: 'wip', from: null }
    });

    expect(steps[2]?.argv).toEqual(['commit', '-m', 'WIP']);
  });

  it('carries the changes onto a branch cut from the target', () =>
  {
    const steps = buildCheckoutSteps({
      ref: 'origin/feature',
      branch: { mode: 'carry', name: 'feature-local' }
    });

    expect(steps.map((step) => step.argv)).toEqual([
      ['checkout', '-b', 'feature-local', 'origin/feature']
    ]);
  });

  /**
   * The one that deliberately never checks out the ref.
   *
   * `git stash branch` creates the branch at the commit the stash was taken on and
   * switches to it, so a `checkout main` between these two would be undone by the next
   * line. A step in the preview that changes nothing is worse than no step at all, and
   * the radio's own wording says where you end up, which is why this is a promise the
   * builder has to keep.
   */
  it('stashes and re-applies on a branch, with no checkout in between', () =>
  {
    const steps = buildCheckoutSteps({
      ref: 'main',
      branch: { mode: 'stash', name: 'my-work' },
      stashUntracked: true
    });

    expect(steps.map((step) => step.argv)).toEqual([
      ['stash', 'push', '-u'],
      ['stash', 'branch', 'my-work']
    ]);
  });

  it('ignores an unnamed branch plan, as a form still being filled in', () =>
  {
    const steps = buildCheckoutSteps({
      ref: 'main',
      branch: { mode: 'commit', name: '' }
    });

    expect(steps.map((step) => step.argv)).toEqual([['checkout', 'main']]);
  });

  it('builds a plan for every strategy the table lists', () =>
  {
    // The table is what the radios render *and* what the argv comes from. A row whose
    // steps were empty would draw an option that ran nothing at all.
    for (const entry of LOCAL_CHANGE_BRANCHES)
    {
      const steps = buildCheckoutSteps({
        ref: 'main',
        branch: { mode: entry.mode, name: 'x', from: 'y' }
      });
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps)
      {
        expect(step.argv[0]).not.toBe('');
      }
    }
  });
});

/**
 * Which checkouts make a branch, and so which have to reload the ref list.
 *
 * This was the bug: `CHECKOUT` is `head` and `worktree`, because a local checkout creates
 * nothing. Checking out a remote branch runs `checkout -B feature origin/feature`, which
 * makes one, and nothing said so. The panel filled it in a second later when the `.git`
 * watcher fired with `ALL_FACETS`, which is why it looked like a timing problem rather
 * than a missing declaration, and why it sometimes did not fill in at all.
 *
 * Asserted against the argv rather than beside it: a flag that creates a branch and a rule
 * that says none was created is exactly the pair that drifted.
 */
describe('checkoutCreatesBranch', () =>
{
  const CREATING_FLAGS = ['-b', '-B'];

  it('creates nothing when checking out a local branch', () =>
  {
    for (const mode of ['none', 'create', 'reset'] as NewBranchMode[])
    {
      expect(checkoutCreatesBranch(false, mode)).toBe(false);
    }
  });

  it('creates a branch for a remote branch, unless the checkout is detached', () =>
  {
    expect(checkoutCreatesBranch(true, 'reset')).toBe(true);
    expect(checkoutCreatesBranch(true, 'create')).toBe(true);
    expect(checkoutCreatesBranch(true, 'none')).toBe(false);
  });

  it('agrees with the argv about which modes create one', () =>
  {
    // The two halves that drifted: whichever mode puts `-b` or `-B` in the command is the
    // one that has made a ref the panel has never heard of.
    for (const mode of ['none', 'create', 'reset'] as NewBranchMode[])
    {
      const argv = buildCheckoutArgs({
        ref: 'origin/feature',
        remote: true,
        localChanges: 'none',
        newBranchMode: mode,
        newBranchName: 'feature'
      });
      const argvCreates = argv.some((arg) => CREATING_FLAGS.includes(arg));
      expect(checkoutCreatesBranch(true, mode)).toBe(argvCreates);
    }
  });
});
