/**
 * Repository housekeeping commands (operand is repo, not a commit). Declared here, built in maintenance.actions.ts.
 */

import { declareCommand, hasRepo } from './registry.js';


export function registerMaintenanceCommands(): void
{
  // ── Git maintenance ─────────────────────────────────────────────────────────
  // An ellipsis, because this does open a window: gc takes minutes and its progress is
  // the reason the window exists.
  declareCommand('repo.gc', 'Compress Git Database…', 'Repository', hasRepo);
  declareCommand('repo.fsck', 'Recover Lost Objects…', 'Repository', hasRepo);
  /**
   * Delete `.git/index.lock`.
   *
   * Not gated on the lock existing, deliberately. A `when` that answered it would have to
   * stat the filesystem on every keystroke: the cost `repo.goToSuperproject`'s comment
   * warns about, and the row is reached for precisely when git has just refused to do
   * something, which is a moment when "there was no lock" is a useful answer rather than a
   * reason to grey the row.
   */
  declareCommand('repo.deleteIndexLock', 'Delete index.lock…', 'Repository', hasRepo);

  // ── The repository's text files ─────────────────────────────────────────────
  /**
   * Four rows onto one window.
   *
   * Each label names its file, which is what makes them stand apart in the palette without
   * needing a group to lean on. `file.ignore` is the neighbouring command and a different
   * question: it appends *a rule* about a path you selected, where these open the file.
   */
  declareCommand('repo.editGitignore', 'Edit .gitignore…', 'Repository', hasRepo);
  declareCommand('repo.editExclude', 'Edit .git/info/exclude…', 'Repository', hasRepo);
  declareCommand('repo.editGitattributes', 'Edit .gitattributes…', 'Repository', hasRepo);
  declareCommand('repo.editConfig', 'Edit .git/config…', 'Repository', hasRepo);

  // ── Patches ─────────────────────────────────────────────────────────────────
  /**
   * Read a `.patch` file without applying it.
   *
   * `'Patch'`, beside `patch.apply` and `patch.format`, and named apart from them for the
   * palette's sake: "View Patch File…" cannot be confused with "Apply Patch…" in a list
   * that shows a group and a label and nothing else.
   */
  declareCommand('patch.view', 'View Patch File…', 'Patch', hasRepo);
}
