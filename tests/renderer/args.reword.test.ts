/**
 * The reword argv.
 *
 * Two shapes, and the split between them is the whole table: rewording HEAD is one
 * `--amend`, and rewording anything below it is an `amend!` marker plus an autosquash
 * rebase. What these guard is mostly the flags that are easy to drop and expensive to
 * lose: `--only` (without it a reword commits whatever happens to be staged),
 * `--allow-empty` (the marker has no changes by construction, so git refuses it), and the
 * `amend! ` prefix carrying the *old* subject, which is the only thing `--autosquash`
 * matches on.
 *
 * That these argv do what the comments claim is not something a unit test can show:
 * `tests/main/git.integration.test.ts` runs them against real git for that.
 */

import { describe, expect, it } from 'vitest';
import { buildRewordSteps } from '@renderer/model/args/reword.js';

const base = { sha: 'abc123', subject: 'Add rate limiter', message: 'Add a rate limiter' };

describe('buildRewordSteps', () =>
{
  it('rewording HEAD is one amend', () =>
  {
    expect(buildRewordSteps({ ...base, isHead: true })).toEqual([
      {
        label: 'Rewording the commit failed',
        argv: ['commit', '--amend', '--only', '-m', 'Add a rate limiter']
      }
    ]);
  });

  it('rewording anything else writes an amend! marker and folds it in', () =>
  {
    expect(buildRewordSteps({ ...base, isHead: false }).map((s) => s.argv)).toEqual([
      [
        'commit',
        '--only',
        '--allow-empty',
        '-m',
        'amend! Add rate limiter',
        '-m',
        'Add a rate limiter'
      ],
      ['rebase', '-i', '--autosquash', '--autostash', 'abc123^']
    ]);
  });

  it('the marker names the old subject, not the new message', () =>
  {
    // What `--autosquash` matches on. Building it from the message being written would
    // find nothing, and the marker would be left on the branch as an ordinary commit.
    const [marker] = buildRewordSteps({
      ...base,
      subject: 'Old subject',
      message: 'Completely different text',
      isHead: false
    });
    expect(marker?.argv).toContain('amend! Old subject');
  });

  it('--only is present in both shapes', () =>
  {
    // Without it a reword commits whatever is staged: the one way this can destroy work
    // rather than merely fail.
    for (const isHead of [true, false])
    {
      const [first] = buildRewordSteps({ ...base, isHead });
      expect(first?.argv).toContain('--only');
    }
  });

  it('each step carries the sentence its failure belongs to', () =>
  {
    const steps = buildRewordSteps({ ...base, isHead: false });
    expect(steps.map((s) => s.label)).toEqual([
      'Writing the new message failed',
      'Applying the message failed, the amend! commit is still on the branch'
    ]);
  });

  it('a blank message runs nothing', () =>
  {
    expect(buildRewordSteps({ ...base, message: '   ', isHead: true })).toEqual([]);
    expect(buildRewordSteps({ ...base, message: '', isHead: false })).toEqual([]);
  });

  it('no commit runs nothing', () =>
  {
    expect(buildRewordSteps({ ...base, sha: '', isHead: false })).toEqual([]);
  });

  it('the message is trimmed', () =>
  {
    // The box is prefilled from `git log --format=%B` and edited by hand; trailing blank
    // lines are what that produces and not something anyone means.
    const [step] = buildRewordSteps({ ...base, message: '\n Tidy up \n\n', isHead: true });
    expect(step?.argv.at(-1)).toBe('Tidy up');
  });

  it('a multi-paragraph message stays one argument', () =>
  {
    const body = 'Subject line\n\nA body paragraph.\n\nCo-Authored-By: Someone';
    const [step] = buildRewordSteps({ ...base, message: body, isHead: true });
    expect(step?.argv.at(-1)).toBe(body);
  });
});
