/**
 * Joining a path from git back onto the repository it came from.
 *
 * The panel holds both kinds at once: a worktree lives elsewhere on disk and so carries
 * an absolute path, a submodule is a directory inside the repository and so carries the
 * repo-relative one git answers with. Handing the second to the OS unresolved is a path
 * relative to wherever the app was launched from, and the open fails silently: no error,
 * no window, nothing to see. That is the failure this covers.
 */

import { describe, expect, it } from 'vitest';
import { toNativePath, toRepoRelative } from '@renderer/model/paths.js';

describe('toNativePath', () =>
{
  it('roots a repo-relative path on the repository', () =>
  {
    expect(toNativePath('/work/app', 'vendor/lib')).toBe('/work/app/vendor/lib');
  });

  it('leaves an already-rooted path alone', () =>
  {
    // A worktree's path, which is somewhere else entirely: joining it onto the
    // repository would name a directory that does not exist.
    expect(toNativePath('/work/app', '/elsewhere/app-wt')).toBe('/elsewhere/app-wt');
  });

  it('separates the way the repository root is separated', () =>
  {
    expect(toNativePath('C:\\work\\app', 'vendor/lib')).toBe('C:\\work\\app\\vendor\\lib');
    expect(toNativePath('C:\\work\\app', 'D:\\other')).toBe('D:\\other');
  });

  it('undoes toRepoRelative for a path inside the repository', () =>
  {
    // The two are a pair, and a round trip is the cheapest statement of that.
    expect(toNativePath('/work/app', toRepoRelative('/work/app', '/work/app/src/main.ts')))
      .toBe('/work/app/src/main.ts');
  });
});
