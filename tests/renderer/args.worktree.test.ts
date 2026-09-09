/**
 * `git worktree` argv.
 *
 * The case worth pinning is that the checkout is a one-of: `-b <name>`, a bare branch
 * name, or `--detach`. Emitting two of them produces a command git rejects, and emitting
 * none produces a worktree on a branch nobody chose.
 */

import { describe, expect, it } from 'vitest';
import {
  buildWorktreeAddArgs,
  buildWorktreePruneArgs,
  buildWorktreeRemoveArgs
} from '@renderer/model/args/worktree.js';
import { toRepoRelative } from '@renderer/model/paths.js';

describe('buildWorktreeAddArgs', () =>
{
  it('a new branch', () =>
  {
    expect(
      buildWorktreeAddArgs({ path: '../feature', checkout: 'new-branch', branch: 'feature' })
    ).toEqual(['worktree', 'add', '-b', 'feature', '../feature']);
  });

  it('a new branch from somewhere other than HEAD', () =>
  {
    expect(
      buildWorktreeAddArgs({
        path: '../feature',
        checkout: 'new-branch',
        branch: 'feature',
        startPoint: 'origin/main'
      })
    ).toEqual(['worktree', 'add', '-b', 'feature', '../feature', 'origin/main']);
  });

  it('an existing branch is the commit-ish, not a -b', () =>
  {
    expect(
      buildWorktreeAddArgs({ path: '../fix', checkout: 'existing-branch', branch: 'hotfix' })
    ).toEqual(['worktree', 'add', '../fix', 'hotfix']);
  });

  it('detached at a revision', () =>
  {
    expect(
      buildWorktreeAddArgs({ path: '../look', checkout: 'detach', startPoint: 'v1.0' })
    ).toEqual(['worktree', 'add', '--detach', '../look', 'v1.0']);
  });

  it('never emits two ways of saying what to check out', () =>
  {
    for (const checkout of ['new-branch', 'existing-branch', 'detach'] as const)
    {
      const argv = buildWorktreeAddArgs({
        path: '../w',
        checkout,
        branch: 'b',
        startPoint: 'v1.0'
      });
      const ways = [argv.includes('-b'), argv.includes('--detach')].filter(Boolean).length;
      expect(ways).toBeLessThanOrEqual(1);
    }
  });

  it('sets worktree.useRelativePaths only when asked', () =>
  {
    // Written only when the repository has not set it, otherwise the command log carries
    // a config decision nobody made.
    expect(
      buildWorktreeAddArgs({
        path: '../w',
        branch: 'b',
        setRelativePaths: true
      })
    ).toEqual(['-c', 'worktree.useRelativePaths=true', 'worktree', 'add', '-b', 'b', '../w']);
    expect(buildWorktreeAddArgs({ path: '../w', branch: 'b' })).not.toContain('-c');
  });

  it('--force comes before the branch, as git documents it', () =>
  {
    const argv = buildWorktreeAddArgs({ path: '../w', branch: 'b', force: true });
    expect(argv.indexOf('--force')).toBeLessThan(argv.indexOf('-b'));
  });

  it('is empty without a path', () =>
  {
    expect(buildWorktreeAddArgs({ path: '  ', branch: 'b' })).toEqual([]);
  });

  it('is empty when a branch is needed and none was given', () =>
  {
    expect(buildWorktreeAddArgs({ path: '../w', checkout: 'new-branch' })).toEqual([]);
    expect(buildWorktreeAddArgs({ path: '../w', checkout: 'existing-branch' })).toEqual([]);
    // Detaching needs no branch at all: HEAD is a perfectly good start point.
    expect(buildWorktreeAddArgs({ path: '../w', checkout: 'detach' })).toEqual([
      'worktree',
      'add',
      '--detach',
      '../w'
    ]);
  });
});

describe('buildWorktreeRemoveArgs', () =>
{
  it('removes one', () =>
  {
    expect(buildWorktreeRemoveArgs({ path: '../feature' })).toEqual([
      'worktree',
      'remove',
      '../feature'
    ]);
  });

  it('forces past uncommitted changes when asked', () =>
  {
    expect(buildWorktreeRemoveArgs({ path: '../feature', force: true })).toEqual([
      'worktree',
      'remove',
      '--force',
      '../feature'
    ]);
  });

  it('is empty without a path', () =>
  {
    expect(buildWorktreeRemoveArgs({ path: '' })).toEqual([]);
  });
});

describe('buildWorktreePruneArgs', () =>
{
  it('is verbose, so the output says what it did', () =>
  {
    expect(buildWorktreePruneArgs()).toEqual(['worktree', 'prune', '-v']);
  });

  it('previews', () =>
  {
    expect(buildWorktreePruneArgs({ dryRun: true })).toEqual([
      'worktree',
      'prune',
      '--dry-run',
      '-v'
    ]);
  });
});

describe('toRepoRelative', () =>
{
  it('a sibling directory is one level up', () =>
  {
    expect(toRepoRelative('/work/repo', '/work/repo-feature')).toBe('../repo-feature');
  });

  it('a directory inside the repository is a plain name', () =>
  {
    expect(toRepoRelative('/work/repo', '/work/repo/worktrees/a')).toBe('worktrees/a');
  });

  it('normalises Windows separators: git takes forward slashes everywhere', () =>
  {
    expect(toRepoRelative('C:\\work\\repo', 'C:\\work\\feature')).toBe('../feature');
  });

  it('keeps the absolute path when the two share no root', () =>
  {
    expect(toRepoRelative('/work/repo', '/elsewhere/thing')).toBe('/elsewhere/thing');
    expect(toRepoRelative('C:\\work\\repo', 'D:\\thing')).toBe('D:/thing');
  });

  it('keeps the absolute path rather than climbing more than two levels', () =>
  {
    // `../../../../x` is not more readable than the path it came from.
    expect(toRepoRelative('/a/b/c/d/repo', '/a/x')).toBe('/a/x');
  });

  it('tolerates a trailing separator on either side', () =>
  {
    expect(toRepoRelative('/work/repo/', '/work/repo/wt/')).toBe('wt');
  });
});
