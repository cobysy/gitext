/**
 * `searchGrep` against real git.
 *
 * The parser unit tests in `tests/shared/grep.test.ts` describe output this file proves
 * git actually produces: the shape of `-z --line-number`, the `<rev>:` prefix on a
 * revision search, and the exit code 1 that means "no matches" rather than "failed". None
 * of those three is documented anywhere the compiler can see, and all three would fail
 * silently: a wrong exit-code assumption turns every empty search into an error dialog,
 * and a wrong prefix assumption puts `<sha>:path` in every row of the results list.
 */

import { mkdtemp, mkdir, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchGrep } from '@main/git/grep.js';
import { runGit } from '@main/git/runner.js';
import type { GrepOptions } from '@shared/grep.js';

let root = '';
let repo = '';
let firstCommit = '';

const ID = ['-c', 'user.name=Tour', '-c', 'user.email=tour@example.com', '-c', 'commit.gpgsign=false'];

const options = (overrides: Partial<GrepOptions> = {}): GrepOptions => ({
  pattern: 'needle',
  mode: 'fixed',
  ignoreCase: false,
  wholeWord: false,
  endpoint: { kind: 'workingTree' },
  ...overrides
});

beforeAll(async () =>
{
  // git canonicalizes paths and /var is a symlink to /private/var on macOS.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-grep-test-')));
  repo = join(root, 'repo');
  await mkdir(join(repo, 'src'), { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);

  await writeFile(join(repo, 'src', 'one.txt'), 'a needle here\nnothing\nNEEDLE shouting\n');
  await writeFile(join(repo, 'src', 'two.txt'), 'needlework is a whole word away\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, [...ID, 'commit', '-m', 'the first commit']);
  firstCommit = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();

  // The second commit takes the needle out, so a search of the working tree and a search
  // of the first commit give visibly different answers, which is the whole point of
  // being able to search a revision.
  await writeFile(join(repo, 'src', 'one.txt'), 'all gone\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, [...ID, 'commit', '-m', 'take it out']);

  // Untracked, so it must never appear: `git grep` searches what git knows about, and
  // that is one of the two reasons to prefer it to a filesystem search.
  await writeFile(join(repo, 'untracked.txt'), 'needle in an untracked file\n');
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('searchGrep', () =>
{
  it('finds a match in the working tree, with its line number and the whole line', async () =>
  {
    const { hits, truncated } = await searchGrep(repo, options());
    expect(hits).toEqual([
      { path: 'src/two.txt', line: 1, text: 'needlework is a whole word away' }
    ]);
    expect(truncated).toBe(false);
  });

  it('never reaches a file git is not tracking', async () =>
  {
    const { hits } = await searchGrep(repo, options());
    expect(hits.map((hit) => hit.path)).not.toContain('untracked.txt');
  });

  it('searches a commit, and strips the prefix git echoes in front of every path', async () =>
  {
    const { hits } = await searchGrep(
      repo,
      options({ endpoint: { kind: 'commit', sha: firstCommit } })
    );
    // The file the second commit emptied is back: this is what searching a revision is
    // for, and the path is repository-relative, not `<sha>:src/one.txt`.
    expect(hits.map((hit) => `${hit.path}:${hit.line}`)).toEqual([
      'src/one.txt:1',
      'src/two.txt:1'
    ]);
  });

  it('honours -i and -w the way the dialog offers them', async () =>
  {
    const shouting = await searchGrep(
      repo,
      options({ ignoreCase: true, endpoint: { kind: 'commit', sha: firstCommit } })
    );
    expect(shouting.hits.map((hit) => hit.text)).toContain('NEEDLE shouting');

    const whole = await searchGrep(repo, options({ wholeWord: true }));
    // `needlework` is the only match in the working tree, and `-w` rules it out.
    expect(whole.hits).toEqual([]);
  });

  it('answers an empty list when nothing matches, rather than failing', async () =>
  {
    // `git grep` exits 1 when it finds nothing. Left to `runGit` that is a rejection, and
    // every fruitless search would show git's silence as an error.
    await expect(searchGrep(repo, options({ pattern: 'no-such-text-anywhere' }))).resolves.toEqual({
      hits: [],
      truncated: false
    });
  });

  it('still reports a real failure', async () =>
  {
    // An unparseable regex exits non-zero for a reason worth surfacing, and it must not be
    // flattened into "no matches" by the exit-code rule above.
    await expect(searchGrep(repo, options({ pattern: 'a[', mode: 'extended' }))).rejects.toThrow();
  });

  it('limits the search to the pathspecs it is given', async () =>
  {
    const inside = await searchGrep(
      repo,
      options({ endpoint: { kind: 'commit', sha: firstCommit }, paths: ['src/two.txt'] })
    );
    expect(inside.hits.map((hit) => hit.path)).toEqual(['src/two.txt']);
  });

  it('searches the index, which is neither of the other two', async () =>
  {
    // Staged but not committed: absent from HEAD, and, since the file on disk is going to
    // be changed afterwards: different from the working tree too.
    await writeFile(join(repo, 'src', 'staged.txt'), 'a needle staged\n');
    await runGit(repo, ['add', 'src/staged.txt']);
    await writeFile(join(repo, 'src', 'staged.txt'), 'no longer\n');

    const staged = await searchGrep(repo, options({ endpoint: { kind: 'index' } }));
    expect(staged.hits.map((hit) => hit.path)).toContain('src/staged.txt');

    const working = await searchGrep(repo, options());
    expect(working.hits.map((hit) => hit.path)).not.toContain('src/staged.txt');
  });
});
