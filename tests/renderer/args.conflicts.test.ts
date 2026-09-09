/**
 * Resolving a conflict, and finishing what caused one.
 *
 * The two cases worth having are both ones a reasonable implementation gets wrong:
 * `checkout --ours` on its own leaves the file still conflicted, and `merge --continue`
 * opens an editor where `commit --no-edit` does not.
 */

import { describe, expect, it } from 'vitest';
import {
  buildMarkResolvedArgs,
  buildMergetoolArgs,
  buildTakeAllSideSteps,
  buildTakeSideSteps,
  CONFLICTED_OPERATIONS,
  CONFLICT_SIDES,
  operationInfo
} from '@renderer/model/args/conflicts.js';

describe('buildTakeSideSteps', () =>
{
  it('checks the side out and then stages it: two commands, not one', () =>
  {
    // `git checkout --ours -- <path>` writes that side into the working tree and leaves
    // the path *still conflicted* in the index. A dialog that stopped there would show the
    // file as resolved while `git status` disagreed.
    expect(buildTakeSideSteps('ours', 'src/a.ts')).toEqual([
      {
        label: 'Checking out the ours version of src/a.ts',
        argv: ['checkout', '--ours', '--', 'src/a.ts']
      },
      { label: 'Marking src/a.ts resolved', argv: ['add', '--', 'src/a.ts'] }
    ]);
  });

  it('uses --theirs for the other side', () =>
  {
    expect(buildTakeSideSteps('theirs', 'a.txt')[0]?.argv).toEqual([
      'checkout',
      '--theirs',
      '--',
      'a.txt'
    ]);
  });

  it('separates the path from the flags with --, so a path named like one is safe', () =>
  {
    // A file called `--ours` is legal and would otherwise be read as a second flag.
    for (const side of CONFLICT_SIDES)
    {
      const argv = buildTakeSideSteps(side.side, '--ours')[0]?.argv ?? [];
      expect(argv.at(-2)).toBe('--');
      expect(argv.at(-1)).toBe('--ours');
    }
  });
});

describe('buildTakeAllSideSteps', () =>
{
  it('names every path in one checkout and one add', () =>
  {
    // Two commands whatever the count, not two per file: forty conflicts would otherwise
    // be eighty rows in the command log saying nothing these two do not.
    expect(buildTakeAllSideSteps('theirs', ['a.txt', 'b/c.txt'])).toEqual([
      {
        label: 'Checking out the theirs version of all 2 files',
        argv: ['checkout', '--theirs', '--', 'a.txt', 'b/c.txt']
      },
      { label: 'Marking all 2 files resolved', argv: ['add', '--', 'a.txt', 'b/c.txt'] }
    ]);
  });

  it('says "the file" rather than "all 1 files"', () =>
  {
    expect(buildTakeAllSideSteps('ours', ['only.txt'])[0]?.label).toBe(
      'Checking out the ours version of the file'
    );
  });

  it('builds nothing when there is nothing conflicted', () =>
  {
    // An empty list would otherwise produce `git checkout --ours --`, which is every file.
    expect(buildTakeAllSideSteps('ours', [])).toEqual([]);
  });

  it('puts -- before the paths', () =>
  {
    const argv = buildTakeAllSideSteps('ours', ['--theirs', 'b.txt'])[0]?.argv ?? [];
    expect(argv).toEqual(['checkout', '--ours', '--', '--theirs', 'b.txt']);
  });
});

describe('the side names', () =>
{
  it('describes each side differently for a rebase, because git swaps them', () =>
  {
    // During a rebase "ours" is the branch being replayed *onto* and "theirs" is your own
    // commit: the opposite of what both words suggest. A dialog that showed only the
    // flags would be a coin flip.
    for (const side of CONFLICT_SIDES)
    {
      expect(side.merging).not.toBe(side.rebasing);
      expect(side.merging.length).toBeGreaterThan(0);
      expect(side.rebasing.length).toBeGreaterThan(0);
    }
  });
});

describe('buildMergetoolArgs', () =>
{
  it('passes --no-prompt, since there is no terminal to answer the prompt in', () =>
  {
    expect(buildMergetoolArgs(['a.txt'])).toEqual(['mergetool', '--no-prompt', '--', 'a.txt']);
  });

  it('names every selected path in one command', () =>
  {
    expect(buildMergetoolArgs(['a.txt', 'b/c.txt'])).toEqual([
      'mergetool',
      '--no-prompt',
      '--',
      'a.txt',
      'b/c.txt'
    ]);
  });
});

describe('buildMarkResolvedArgs', () =>
{
  it('is a plain add: for a file edited by hand', () =>
  {
    expect(buildMarkResolvedArgs(['a.txt'])).toEqual(['add', '--', 'a.txt']);
  });

  it('names every selected path in one command', () =>
  {
    expect(buildMarkResolvedArgs(['a.txt', 'b/c.txt'])).toEqual(['add', '--', 'a.txt', 'b/c.txt']);
  });
});

describe('CONFLICTED_OPERATIONS', () =>
{
  it('finishes a merge with `commit --no-edit`, not `merge --continue`', () =>
  {
    // `merge --continue` exists and opens an editor for the message. The merge that
    // stopped already has its message in `.git/MERGE_MSG`, and `commit --no-edit` takes
    // it, which is also what git itself prints when the merge stops.
    expect(operationInfo('merge')?.continueArgv).toEqual(['commit', '--no-edit']);
  });

  it.each(CONFLICTED_OPERATIONS.map((entry) => entry.operation))(
    'aborts %s with its own --abort',
    (operation) =>
    {
      expect(operationInfo(operation)?.abortArgv).toEqual([operation, '--abort']);
    }
  );

  it('covers every operation that can leave a conflict', () =>
  {
    expect(CONFLICTED_OPERATIONS.map((entry) => entry.operation)).toEqual([
      'merge',
      'rebase',
      'cherry-pick',
      'revert',
      'am'
    ]);
  });

  it('answers null for an operation that cannot conflict', () =>
  {
    // `bisect` is an in-progress operation the repository can be in, and it has no
    // conflicts and no --continue. The dialog draws a Close button on that answer.
    expect(operationInfo('bisect')).toBeNull();
    expect(operationInfo('none')).toBeNull();
  });
});
