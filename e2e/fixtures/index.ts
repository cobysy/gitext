import { buildCommitRepo } from './commitRepo.js';
import { buildConflictsRepo } from './conflictsRepo.js';
import { buildDialogsRepo } from './dialogsRepo.js';

/**
 * Which repository each spec drives, keyed by the name the spec declares.
 *
 * A table rather than a function passed through `test.use`: Playwright reads a function
 * in a fixture value as a fixture *factory*, so an option that is a builder cannot be
 * spelled at all. Naming the tour picks its repository, and adding a spec is adding a row
 * here.
 */
export const REPO_BUILDERS: Record<string, (dir: string) => void> = {
  commit: buildCommitRepo,
  conflicts: buildConflictsRepo,
  // One repository, built three times. The dialog steps are a third of a list each, and
  // each third drives a copy of its own: that is what lets the three run at once, and it
  // costs one `buildDialogsRepo` per file rather than one shared one they would have to
  // queue for.
  'dialogs-branches': buildDialogsRepo,
  'dialogs-worktree': buildDialogsRepo,
  'dialogs-history': buildDialogsRepo
};
