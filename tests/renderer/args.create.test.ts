/**
 * `git clone` and `git init` argv.
 *
 * The two commands that make a repository rather than acting on one, which is what makes
 * their argv worth pinning: every other dialog runs in the repository the window has open,
 * and a mistake here is a repository in the wrong place rather than a command that fails.
 */

import { describe, expect, it } from 'vitest';
import { buildCloneArgs, buildInitArgs } from '@renderer/model/args/create.js';

describe('buildCloneArgs', () =>
{
  it('clones a URL to a destination, and nothing else by default', () =>
  {
    expect(buildCloneArgs({ url: 'git@host:o/r.git', destination: '/tmp/r' })).toEqual([
      'clone',
      'git@host:o/r.git',
      '/tmp/r'
    ]);
  });

  it('always names the destination, so the working directory never decides it', () =>
  {
    // The run happens in the folder the clone goes into, not in a repository: `git clone`
    // with no destination would name the directory after the URL, somewhere the preview
    // never said.
    const argv = buildCloneArgs({ url: 'https://host/o/r.git', destination: '/tmp/mine' });
    expect(argv.at(-1)).toBe('/tmp/mine');
    expect(argv.at(-2)).toBe('https://host/o/r.git');
  });

  it('truncates history only when asked for a real depth', () =>
  {
    // Git rejects `--depth 0`, and an empty number field reads as 0: the flag comes off
    // rather than being passed through to fail.
    expect(buildCloneArgs({ url: 'u', destination: 'd', depth: 1 })).toContain('--depth');
    expect(buildCloneArgs({ url: 'u', destination: 'd', depth: 0 })).not.toContain('--depth');
    expect(buildCloneArgs({ url: 'u', destination: 'd' })).not.toContain('--depth');
  });

  it('passes the depth as its own argument, not glued to the flag', () =>
  {
    const argv = buildCloneArgs({ url: 'u', destination: 'd', depth: 25 });
    expect(argv[argv.indexOf('--depth') + 1]).toBe('25');
  });

  it('carries the branch, submodules and bare flags when they are set', () =>
  {
    expect(
      buildCloneArgs({
        url: 'u',
        destination: 'd',
        branch: 'release',
        recurseSubmodules: true,
        bare: true
      })
    ).toEqual(['clone', '--branch', 'release', '--recurse-submodules', '--bare', 'u', 'd']);
  });

  it('leaves an unticked option off entirely', () =>
  {
    const argv = buildCloneArgs({
      url: 'u',
      destination: 'd',
      recurseSubmodules: false,
      bare: false,
      branch: ''
    });
    expect(argv).toEqual(['clone', 'u', 'd']);
  });
});

describe('buildInitArgs', () =>
{
  it('makes a repository in the named directory', () =>
  {
    expect(buildInitArgs({ directory: '/tmp/new' })).toEqual(['init', '/tmp/new']);
  });

  it('names the first branch only when one was given', () =>
  {
    // Empty means "whatever this machine's `init.defaultBranch` says", which is not the
    // same as naming a default here and overriding it.
    expect(buildInitArgs({ directory: '/d', initialBranch: 'main' })).toEqual([
      'init',
      '--initial-branch=main',
      '/d'
    ]);
    expect(buildInitArgs({ directory: '/d', initialBranch: '' })).toEqual(['init', '/d']);
  });

  it('joins the initial branch with an equals sign', () =>
  {
    // `--initial-branch main` is accepted too, but the joined form cannot be mistaken for
    // a positional argument if the name is ever empty.
    expect(buildInitArgs({ directory: '/d', initialBranch: 'trunk' })[1]).toBe(
      '--initial-branch=trunk'
    );
  });

  it('puts the directory last, after every flag', () =>
  {
    const argv = buildInitArgs({ directory: '/d', initialBranch: 'main', bare: true });
    expect(argv.at(-1)).toBe('/d');
    expect(argv).toEqual(['init', '--initial-branch=main', '--bare', '/d']);
  });
});
