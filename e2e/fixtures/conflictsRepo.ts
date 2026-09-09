import * as fs from 'node:fs';
import { IDENT, Repo } from '../support/repo.js';

/**
 * One commit on `main`, and nothing else.
 *
 * Deliberately bare, unlike the dialogs fixture: every step builds the exact divergence
 * it needs and is therefore runnable alone, which is the one thing a suite of destructive
 * operations must not lose.
 */
export function buildConflictsRepo(dir: string): void
{
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const repo = new Repo(dir);
  repo.git(['init', '-q', '-b', 'main']);
  repo.write('readme.txt', 'a repository to break\n');
  repo.git(['add', '-A']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'first']);
}

/** `{ path: [base, ours, theirs] }`: what each side of a divergence writes to each file. */
export type ConflictingEdits = Record<string, [string, string, string]>;

/**
 * Build a two-branch divergence and leave the merge conflicted.
 *
 * What it leaves behind is the repository mid-merge, which is what most steps here start
 * from.
 */
export function conflictingMerge(repo: Repo, name: string, files: ConflictingEdits): void
{
  repo.git(['checkout', '-q', '-B', `${name}-base`, 'main']);
  for (const [rel, [base]] of Object.entries(files))
  {
    repo.write(rel, base);
  }
  repo.commitAll(`${name}: base`);

  repo.git(['checkout', '-q', '-B', `${name}-other`]);
  for (const [rel, [, , theirs]] of Object.entries(files))
  {
    repo.write(rel, theirs);
  }
  repo.commitAll(`${name}: their edit`);

  repo.git(['checkout', '-q', `${name}-base`]);
  for (const [rel, [, ours]] of Object.entries(files))
  {
    repo.write(rel, ours);
  }
  repo.commitAll(`${name}: my edit`);

  repo.git(['merge', `${name}-other`]);
}
