import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IDENT, Repo } from '../support/repo.js';

/**
 * Where the two repository-making steps put what they make.
 *
 * Beside the fixture rather than inside it: a repository nested in the one under test
 * would show up in its own status.
 */
export const SCRATCH = path.join(os.tmpdir(), 'gitext-e2e-dialogs-made');

/** The bare repository the fixture pushes to, so the remote operations have a real one. */
export function originOf(dir: string): string
{
  return path.join(dir, '..', `${path.basename(dir)}-origin.git`);
}

/**
 * A repository with everything the dialogs need an operand of: a remote, a diverged
 * tracking branch, a tag, a branch that is behind, and a dirty working tree.
 *
 * Built here rather than shared with `make-commit-fixture.mjs`, which is named for what
 * it covers, the commit screen's awkward diffs, and has none of the refs this needs.
 */
export function buildDialogsRepo(dir: string): void
{
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const origin = originOf(dir);
  fs.rmSync(origin, { recursive: true, force: true });

  const repo = new Repo(dir);
  const commit = (message: string): void =>
  {
    repo.git([...IDENT, 'commit', '-q', '-m', message]);
  };

  repo.git(['init', '-q', '--bare', '-b', 'main', origin], os.tmpdir());
  repo.git(['init', '-q', '-b', 'main', '.']);

  repo.write('a.txt', 'one\n');
  repo.git(['add', '.']);
  commit('base');

  repo.git(['checkout', '-q', '-b', 'feature']);
  repo.write('b.txt', 'two\n');
  repo.git(['add', '.']);
  commit('feature work');

  repo.git(['checkout', '-q', 'main']);
  repo.write('c.txt', 'three\n');
  repo.git(['add', '.']);
  commit('main moves on');

  repo.git(['remote', 'add', 'origin', origin]);
  repo.git(['push', '-q', 'origin', 'main', 'feature']);

  // A branch strictly behind main. Deliberately *not* the root commit: a step that
  // asserts "behind ended up at X" must not be satisfiable by the fixture already having
  // put it there.
  repo.git(['branch', 'behind', 'HEAD~1']);
  repo.git([...IDENT, 'tag', '-a', 'v1.0', '-m', 'the release', 'HEAD~1']);

  // Dirty, with both kinds of change, so the local-changes and reset dialogs have
  // something to decide about.
  repo.write('a.txt', 'one\nedited\n');
  repo.write('untracked.txt', 'new\n');
}
