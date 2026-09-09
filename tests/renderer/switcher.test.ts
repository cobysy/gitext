/**
 * What the working-directory switcher offers.
 *
 * Pure input to pure output, which is why `switcher.ts` takes the four lists rather
 * than reading the stores: the awkward cases, a submodule that is also a recent, an
 * uninitialized submodule, a Windows path, are three lines each here and would each
 * be a fixture repository otherwise.
 */

import { describe, expect, it } from 'vitest';
import { basename, buildSwitcherSections } from '@renderer/switcher.js';
import type { SubmoduleEntry } from '@shared/types.js';

const submodule = (over: Partial<SubmoduleEntry> = {}): SubmoduleEntry => ({
  name: 'lib',
  path: 'lib',
  url: 'https://example.invalid/lib.git',
  branch: null,
  initialized: true,
  ...over
});

const input = {
  currentPath: '/work/app',
  superprojectPath: null,
  submodules: [] as SubmoduleEntry[],
  recentRepos: [] as string[]
};

describe('buildSwitcherSections', () =>
{
  it('drops empty sections rather than drawing empty headings', () =>
  {
    expect(buildSwitcherSections(input)).toEqual([]);
  });

  it('offers the superproject first: it is the way out of a submodule', () =>
  {
    const sections = buildSwitcherSections({ ...input, superprojectPath: '/work/parent' });
    expect(sections.map((s) => s.label)).toEqual(['Superproject']);
    expect(sections[0]?.entries[0]).toMatchObject({
      kind: 'superproject',
      path: '/work/parent',
      name: 'parent',
      enabled: true
    });
  });

  it('resolves a submodule against the repository it is in', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      submodules: [submodule({ path: 'vendor/lib' })]
    });
    expect(sections[0]?.entries[0]?.path).toBe('/work/app/vendor/lib');
  });

  it('takes the separator from the parent path, so Windows paths do not mix them', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      currentPath: 'C:\\work\\app',
      submodules: [submodule({ path: 'vendor/lib' })]
    });
    expect(sections[0]?.entries[0]?.path).toBe('C:\\work\\app\\vendor\\lib');
  });

  it('shows an uninitialized submodule, disabled and saying why', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      submodules: [submodule({ initialized: false })]
    });
    expect(sections[0]?.entries[0]).toMatchObject({ enabled: false, reason: 'Not initialized' });
  });

  it('does not offer the repository that is already open', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      recentRepos: ['/work/app', '/work/other']
    });
    expect(sections[0]?.entries.map((e) => e.path)).toEqual(['/work/other']);
  });

  it('lists a path once, under the section that says the most about it', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      submodules: [submodule({ path: 'lib' })],
      recentRepos: ['/work/app/lib', '/work/other']
    });
    expect(sections.map((s) => s.label)).toEqual(['Submodules', 'Recent']);
    expect(sections[1]?.entries.map((e) => e.path)).toEqual(['/work/other']);
  });

  it('keeps the recent list in the order it was given: newest first', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      recentRepos: ['/work/one', '/work/two', '/work/three']
    });
    expect(sections[0]?.entries.map((e) => e.name)).toEqual(['one', 'two', 'three']);
  });

  it('has nothing to offer below a repository when none is open', () =>
  {
    const sections = buildSwitcherSections({
      ...input,
      currentPath: null,
      submodules: [submodule()],
      recentRepos: ['/work/app']
    });
    // The submodules belong to a repository; with none open the recents are all there is.
    expect(sections.map((s) => s.label)).toEqual(['Recent']);
  });
});

describe('basename', () =>
{
  it('reads either separator and tolerates a trailing one', () =>
  {
    expect(basename('/work/app')).toBe('app');
    expect(basename('C:\\work\\app\\')).toBe('app');
    expect(basename('app')).toBe('app');
  });
});
