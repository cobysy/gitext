import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_DIR } from '../support/app.js';

/**
 * The commit screen's own fixture: a repository full of awkward diffs.
 *
 * Built by `scripts/make-commit-fixture.mjs` rather than here, because that script is
 * also what `npm run fixture:commit` runs when somebody wants the repository by hand to
 * look at. One definition, two callers.
 */
export function buildCommitRepo(dir: string): void
{
  fs.rmSync(dir, { recursive: true, force: true });
  const built = spawnSync(
    process.execPath,
    [path.join(APP_DIR, 'scripts/make-commit-fixture.mjs'), '--path', dir, '--force'],
    { encoding: 'utf8' }
  );
  if (built.status !== 0)
  {
    throw new Error(`could not build the commit fixture:\n${built.stderr}`);
  }
}
