/**
 * `parseFsck` units.
 *
 * The lines here are copied from real `git fsck` runs (see
 * `tests/main/fsck.integration.test.ts`, which proves git still produces them). What this
 * file is really about is everything fsck says that is *not* an object report: it opens
 * with prose, it warns about damage in the same stream, and `error in tree <sha>` is three
 * whitespace-separated tokens ending in a SHA: the exact shape a naive split would accept.
 * A parser that took that would put a corrupt tree in a recovery list as if it were
 * something you could get back.
 */

import { describe, expect, it } from 'vitest';
import { parseFsck } from '@main/git/parse/fsck.js';

const SHA_A = '4cf44bc789f22b8f5af399e32ffaeff5b3829b91';
const SHA_B = '3cd6485eb6b7ac15a9921d42a621d47b30c47cdf';
const SHA_C = '6640fb01ffae1cdd778a3fe65b469f62a5230def';

describe('parseFsck', () =>
{
  it('reads the three states and the four kinds', () =>
  {
    expect(
      parseFsck(
        [
          `dangling blob ${SHA_A}`,
          `unreachable commit ${SHA_B}`,
          `missing tree ${SHA_C}`,
          `dangling tag ${SHA_A}`
        ].join('\n')
      )
    ).toEqual([
      { state: 'dangling', kind: 'blob', sha: SHA_A },
      { state: 'unreachable', kind: 'commit', sha: SHA_B },
      { state: 'missing', kind: 'tree', sha: SHA_C },
      { state: 'dangling', kind: 'tag', sha: SHA_A }
    ]);
  });

  it('keeps git’s order rather than sorting', () =>
  {
    // Sorting is the dialog's decision: it groups by kind and orders commits by date,
    // which needs metadata this does not have. A parser that reordered would make the raw
    // output and the list disagree for no reason anyone could see.
    const parsed = parseFsck(
      [`unreachable commit ${SHA_B}`, `dangling blob ${SHA_A}`].join('\n')
    );
    expect(parsed.map((ref) => ref.sha)).toEqual([SHA_B, SHA_A]);
  });

  it('drops the prose fsck writes around its reports', () =>
  {
    expect(
      parseFsck(
        [
          'Checking object directories: 100% (256/256), done.',
          'Checking objects: 100% (12/12), done.',
          `dangling blob ${SHA_A}`,
          ''
        ].join('\n')
      )
    ).toEqual([{ state: 'dangling', kind: 'blob', sha: SHA_A }]);
  });

  it('does not mistake a damage report for a lost object', () =>
  {
    // `error in tree <sha>: …` and `broken link from <type> <sha>` are the trap: three
    // tokens, the last a SHA. A repository that is damaged is a different problem from one
    // that has lost something, and offering to "recover" a corrupt tree would be a lie.
    expect(
      parseFsck(
        [
          `error in tree ${SHA_C}`,
          `broken link from commit ${SHA_B}`,
          `dangling commit ${SHA_B}`
        ].join('\n')
      )
    ).toEqual([{ state: 'dangling', kind: 'commit', sha: SHA_B }]);
  });

  it('rejects a line whose third token is not a hash', () =>
  {
    expect(parseFsck('dangling commit not-a-sha')).toEqual([]);
    expect(parseFsck(`dangling commit ${SHA_A.slice(0, 12)}`)).toEqual([]);
  });

  it('accepts a SHA-256 object id', () =>
  {
    // git supports both hash algorithms, and a repository initialized with
    // `--object-format=sha256` reports 64 hex characters. Rejecting those would make this
    // dialog silently empty on such a repository.
    const sha256 = 'a'.repeat(64);
    expect(parseFsck(`dangling blob ${sha256}`)).toEqual([
      { state: 'dangling', kind: 'blob', sha: sha256 }
    ]);
  });

  it('is empty for empty output', () =>
  {
    expect(parseFsck('')).toEqual([]);
    expect(parseFsck('\n\n')).toEqual([]);
  });
});
