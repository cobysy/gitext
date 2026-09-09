/**
 * `git clean` argv.
 *
 * The case that matters is `--dry-run` versus `-f`: they are a choice, not a flag and its
 * absence. Neither one and git deletes nothing (`clean.requireForce`); both and the
 * preview says one thing while the command does the other. Everything the dialog offers
 * has to come out one side of that or the other, which is what this table walks.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCleanArgs,
  buildCleanSubmodulesArgs,
  CLEAN_MODES
} from '@renderer/model/args/clean.js';

describe('buildCleanArgs', () =>
{
  it('forces by default: a clean with neither flag deletes nothing', () =>
  {
    expect(buildCleanArgs()).toEqual(['clean', '-f']);
  });

  it('previews instead of deleting', () =>
  {
    expect(buildCleanArgs({ dryRun: true })).toEqual(['clean', '--dry-run']);
  });

  it('never emits both, whatever else is set', () =>
  {
    for (const entry of CLEAN_MODES)
    {
      for (const directories of [true, false])
      {
        for (const dryRun of [true, false])
        {
          const argv = buildCleanArgs({ mode: entry.mode, directories, dryRun });
          expect(argv.includes('--dry-run')).toBe(dryRun);
          expect(argv.includes('-f')).toBe(!dryRun);
        }
      }
    }
  });

  it('the three modes are the three flags', () =>
  {
    expect(buildCleanArgs({ mode: 'untracked' })).toEqual(['clean', '-f']);
    expect(buildCleanArgs({ mode: 'ignored' })).toEqual(['clean', '-X', '-f']);
    expect(buildCleanArgs({ mode: 'all' })).toEqual(['clean', '-x', '-f']);
  });

  it('every mode in the table renders the flag it declares', () =>
  {
    for (const entry of CLEAN_MODES)
    {
      const argv = buildCleanArgs({ mode: entry.mode });
      if (entry.flag)
      {
        expect(argv).toContain(entry.flag);
      }
      else
      {
        expect(argv).toEqual(['clean', '-f']);
      }
    }
  });

  it('-d takes the directories too', () =>
  {
    expect(buildCleanArgs({ mode: 'all', directories: true, dryRun: true })).toEqual([
      'clean',
      '-x',
      '-d',
      '--dry-run'
    ]);
  });

  it('paths go behind a --, so a path that looks like a ref is still a path', () =>
  {
    expect(buildCleanArgs({ paths: ['build', 'dist'] })).toEqual([
      'clean',
      '-f',
      '--',
      'build',
      'dist'
    ]);
  });

  it('excludes come before the --, being flags', () =>
  {
    const argv = buildCleanArgs({ excludes: ['*.env'], paths: ['src'] });
    expect(argv).toEqual(['clean', '-f', '--exclude=*.env', '--', 'src']);
    expect(argv.indexOf('--exclude=*.env')).toBeLessThan(argv.indexOf('--'));
  });

  it('drops blank lines from both boxes: a textarea ends in one', () =>
  {
    expect(
      buildCleanArgs({ paths: ['build', '', '  '], excludes: ['', ' *.log '] })
    ).toEqual(['clean', '-f', '--exclude=*.log', '--', 'build']);
  });

  it('has no -- when there are no paths', () =>
  {
    expect(buildCleanArgs({ paths: [] })).not.toContain('--');
  });
});

describe('buildCleanSubmodulesArgs', () =>
{
  it('is the same clean, run in each submodule', () =>
  {
    expect(
      buildCleanSubmodulesArgs({ mode: 'all', directories: true, dryRun: true })
    ).toEqual(['submodule', 'foreach', '--recursive', 'git', 'clean', '-x', '-d', '--dry-run']);
  });

  it('drops the excludes: they are the superproject’s paths', () =>
  {
    // A pattern written against this repository means nothing one level down.
    expect(buildCleanSubmodulesArgs({ excludes: ['*.env'] }).join(' ')).not.toContain(
      '--exclude'
    );
  });

  it('forces or previews exactly as the superproject clean does', () =>
  {
    for (const dryRun of [true, false])
    {
      const inner = buildCleanSubmodulesArgs({ dryRun });
      const outer = buildCleanArgs({ dryRun });
      expect(inner.slice(inner.indexOf('clean') + 1)).toEqual(outer.slice(1));
    }
  });
});
