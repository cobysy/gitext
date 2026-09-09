/**
 * The guard that keeps a path argument inside the repository.
 *
 * Pure string arithmetic, so it is a unit test rather than one of the integration suites
 * beside it, and worth having its own file, because the thing being asserted is that a
 * path which *looks* contained is rejected. A prefix test on the two strings passes the
 * sibling-directory case, which is exactly the case a reader would assume was covered.
 */

import { describe, expect, it } from 'vitest';
import { resolveInRepo } from '@main/git/file.js';

const REPO = '/w/proj';

describe('resolveInRepo', () =>
{
  it('resolves an ordinary path inside the repository', () =>
  {
    expect(resolveInRepo(REPO, 'src/index.ts')).toBe('/w/proj/src/index.ts');
  });

  it('resolves a path that climbs and comes back', () =>
  {
    expect(resolveInRepo(REPO, 'src/../lib/a.ts')).toBe('/w/proj/lib/a.ts');
  });

  it('refuses a path that climbs out', () =>
  {
    expect(() => resolveInRepo(REPO, '../../.ssh/id_rsa')).toThrow(/outside the repository/);
  });

  /** The repository's path is a string prefix of the sibling's, but not its parent. */
  it('refuses a sibling directory whose name extends the repository’s', () =>
  {
    expect(() => resolveInRepo(REPO, '../projSecret/id_rsa')).toThrow(/outside the repository/);
  });

  it('refuses an absolute path', () =>
  {
    expect(() => resolveInRepo(REPO, '/etc/passwd')).toThrow(/outside the repository/);
  });

  it('refuses the repository root itself, which is not a file', () =>
  {
    expect(() => resolveInRepo(REPO, '.')).toThrow(/outside the repository/);
  });

  /** `..foo` climbs nowhere: only `..` and `../` do. */
  it('allows a file whose name begins with dots', () =>
  {
    expect(resolveInRepo(REPO, '..foo/bar.ts')).toBe('/w/proj/..foo/bar.ts');
  });
});
