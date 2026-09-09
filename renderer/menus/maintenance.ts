/**
 * The toolbar's maintenance menu: the housekeeping whose operand is the repository.
 *
 * These commands act on the whole repository, so no row in any list is the thing they
 * work on: pruning worktrees does not belong on the worktree you right-clicked, and
 * cleaning up merged branches is not something you do *to* the branch you are on. Left
 * one per context menu they were scattered across four surfaces, and reaching one meant
 * knowing which. One button gathers them, and the menu bar keeps its subject copies.
 *
 * Ordered by how much they can cost you: the three that only tidy refs, then the one
 * that deletes files you have never committed, then the database itself.
 */

import { item, separator, type MenuNode } from './resolve.js';

export const maintenanceMenu: MenuNode[] = [
  item('branch.cleanup'),
  item('remote.fetchAllPrune'),
  item('worktree.prune'),
  separator,
  item('workdir.clean'),
  separator,
  item('repo.gc'),
  item('repo.fsck'),
  item('repo.deleteIndexLock')
];
