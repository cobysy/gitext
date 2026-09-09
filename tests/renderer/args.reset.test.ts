/**
 * `git reset`, as `buildResetArgs` and the `ResetMode` table build it.
 *
 * All five modes, because two of them, `--keep` and `--merge`, are the ones that make
 * a reset usable on a dirty working tree, and a table that quietly dropped one would
 * leave the dialog unable to express them.
 */

import { buildCleanArgs } from '@renderer/model/args/clean.js';
import { describe, expect, it } from 'vitest';
import {
  buildDiscardSteps,
  buildResetArgs,
  buildUndoCommitArgs,
  DISCARD_SCOPES,
  RESET_MODES,
  type ResetMode,
  type ResetOptions
} from '@renderer/model/args/reset.js';

const CASES: { name: string; options: ResetOptions; argv: string[] }[] = [
  {
    name: 'soft, move the branch, touch nothing else',
    options: { mode: 'soft', commit: 'HEAD~1' },
    argv: ['reset', '--soft', 'HEAD~1']
  },
  {
    name: 'mixed, the default git itself uses',
    options: { mode: 'mixed', commit: 'HEAD~1' },
    argv: ['reset', '--mixed', 'HEAD~1']
  },
  {
    name: 'keep, abort rather than overwrite a changed file',
    options: { mode: 'keep', commit: 'HEAD~1' },
    argv: ['reset', '--keep', 'HEAD~1']
  },
  {
    name: 'merge, carry uncommitted changes across',
    options: { mode: 'merge', commit: 'HEAD~1' },
    argv: ['reset', '--merge', 'HEAD~1']
  },
  {
    name: 'hard, discard everything',
    options: { mode: 'hard', commit: 'HEAD~1' },
    argv: ['reset', '--hard', 'HEAD~1']
  },
  {
    name: 'a SHA rather than a revision expression',
    options: { mode: 'mixed', commit: '4a2b1c9' },
    argv: ['reset', '--mixed', '4a2b1c9']
  },
  {
    name: 'quiet, which the dialog deliberately does not pass',
    options: { mode: 'mixed', commit: 'HEAD~1', quiet: true },
    argv: ['reset', '--mixed', '--quiet', 'HEAD~1']
  }
];

describe('buildResetArgs', () =>
{
  for (const { name, options, argv } of CASES)
  {
    it(name, () =>
    {
      expect(buildResetArgs(options)).toEqual(argv);
    });
  }

  it('is not quiet by default: the summary is the answer to "what did that do"', () =>
  {
    // `quiet` defaults to false here, which is the one the dialog actually uses: the
    // summary git prints is the answer to "what did that do to me".
    expect(buildResetArgs({ mode: 'mixed', commit: 'HEAD' })).not.toContain('--quiet');
  });
});

describe('RESET_MODES', () =>
{
  it('is the five modes, least destructive first', () =>
  {
    expect(RESET_MODES.map((entry) => entry.mode)).toEqual([
      'soft',
      'mixed',
      'keep',
      'merge',
      'hard'
    ]);
  });

  it('builds every mode it lists', () =>
  {
    // The table is what the dialog renders *and* what the argv is built from, which is the
    // reason a mode's explanation cannot drift from its flag. This holds the other half:
    // a row that produced no flag would render a radio that runs a plain `git reset`.
    for (const entry of RESET_MODES)
    {
      expect(buildResetArgs({ mode: entry.mode, commit: 'HEAD' })).toEqual([
        'reset',
        entry.flag,
        'HEAD'
      ]);
    }
  });

  it('gives each mode its own documentation anchor', () =>
  {
    const anchors = RESET_MODES.map((entry) => entry.help);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const entry of RESET_MODES)
    {
      expect(entry.help).toContain(entry.flag?.replace(/^--/, '---') ?? '');
    }
  });

  it('tones each mode by what it costs', () =>
  {
    // Soft green, Mixed/Keep/Merge yellow, Hard red.
    // Asserted as a whole row rather than "hard is danger", because the point of the tone
    // is the *contrast*: a table that quietly toned all five the same would still pass a
    // test that only looked at the ends of it.
    expect(RESET_MODES.map((entry) => [entry.mode, entry.tone])).toEqual([
      ['soft', 'safe'],
      ['mixed', 'caution'],
      ['keep', 'caution'],
      ['merge', 'caution'],
      ['hard', 'danger']
    ]);
  });

  it('covers exactly the modes the type allows', () =>
  {
    const all: ResetMode[] = ['soft', 'mixed', 'keep', 'merge', 'hard'];
    expect(RESET_MODES.map((entry) => entry.mode).sort()).toEqual([...all].sort());
  });
});

/**
 * Throwing away uncommitted work.
 *
 * The case worth testing is the second step: neither reset touches an untracked file,
 * so a dialog that offers to "reset your changes" and runs one command leaves every new
 * file where it was. The "delete untracked files" checkbox is what adds the other.
 */
describe('buildDiscardSteps', () =>
{
  it('resets everything tracked, and nothing else, by default', () =>
  {
    expect(buildDiscardSteps({ scope: 'all' })).toEqual([
      { label: 'Resetting your changes', argv: ['reset', '--hard', 'HEAD'] }
    ]);
  });

  it('names HEAD rather than leaving --hard bare', () =>
  {
    // Identical to git either way; a command log that names the commit says what "back"
    // meant, which is the only reason anyone reads it afterwards.
    expect(buildDiscardSteps({ scope: 'all' })[0]?.argv).toContain('HEAD');
  });

  it('resets only what is unstaged with `checkout -- .`', () =>
  {
    expect(buildDiscardSteps({ scope: 'unstaged' })).toEqual([
      { label: 'Resetting your changes', argv: ['checkout', '--', '.'] }
    ]);
  });

  it('adds the clean as a second command when new files go too', () =>
  {
    expect(buildDiscardSteps({ scope: 'all', deleteUntracked: true })).toEqual([
      { label: 'Resetting your changes', argv: ['reset', '--hard', 'HEAD'] },
      { label: 'Deleting untracked files', argv: ['clean', '-d', '-f'] }
    ]);
  });

  it('includes ignored files only when asked', () =>
  {
    expect(
      buildDiscardSteps({ scope: 'unstaged', deleteUntracked: true, includeIgnored: true })
    ).toEqual([
      { label: 'Resetting your changes', argv: ['checkout', '--', '.'] },
      { label: 'Deleting untracked files', argv: ['clean', '-x', '-d', '-f'] }
    ]);
  });

  it('never cleans without being asked, whatever the scope', () =>
  {
    for (const entry of DISCARD_SCOPES)
    {
      const argvs = buildDiscardSteps({ scope: entry.scope }).map((step) => step.argv);
      expect(argvs.some((argv) => argv[0] === 'clean')).toBe(false);
    }
  });

  it('describes every scope it can build', () =>
  {
    for (const entry of DISCARD_SCOPES)
    {
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(buildDiscardSteps({ scope: entry.scope })[0]?.argv).toEqual(entry.argv);
    }
  });
});

describe('the clean the discard dialog runs', () =>
{
  it('removes directories as well as files: a new folder is not a file', () =>
  {
    expect(buildCleanArgs({ directories: true })).toEqual(['clean', '-d', '-f']);
  });

  it('adds -x for ignored files', () =>
  {
    // The mode flag leads.
    expect(buildCleanArgs({ mode: 'all', directories: true })).toEqual([
      'clean',
      '-x',
      '-d',
      '-f'
    ]);
  });
});

describe('buildUndoCommitArgs', () =>
{
  it('is a soft reset to the parent: the changes come back staged', () =>
  {
    expect(buildUndoCommitArgs()).toEqual(['reset', '--soft', 'HEAD~1']);
  });

  it('is the same array the commit screen runs, built once', () =>
  {
    // The menu bar's Undo Last Commit and the commit screen's Reset soft are one
    // operation; two builders would be two chances to disagree about the mode.
    expect(buildUndoCommitArgs()).toEqual(buildResetArgs({ mode: 'soft', commit: 'HEAD~1' }));
  });
});
