/**
 * The payload a dialog was opened with, as the props it is mounted with. The one place
 * that mapping lives: a dialog reads its operand from here, never from the main
 * window's selection, since a dialog window is its own renderer process and that
 * selection may have moved on by the time the form is filled in. Split out of
 * `routes.ts` so it can be tested without a Vue plugin.
 */

import type { DialogName, DialogPayload } from '@shared/dialogs.js';
import { ENDPOINT_KIND_COMMIT } from '@shared/diff.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const REPO_TEXT_FILE_GITIGNORE = 'gitignore';

const DIALOG_BRANCH_CHECKOUT = 'branch.checkout';
const DIALOG_COMMIT_CHECKOUT = 'commit.checkout';
const DIALOG_BRANCH_CREATE = 'branch.create';
const DIALOG_BRANCH_RENAME = 'branch.rename';
const DIALOG_BRANCH_SET_UPSTREAM = 'branch.setUpstream';
const DIALOG_BRANCH_DELETE = 'branch.delete';
const DIALOG_BRANCH_DELETE_REMOTE = 'branch.deleteRemote';
const DIALOG_BRANCH_CLEANUP = 'branch.cleanup';
const DIALOG_REMOTE_PULL = 'remote.pull';
const DIALOG_BRANCH_MERGE = 'branch.merge';
const DIALOG_BRANCH_REBASE = 'branch.rebase';
const DIALOG_RESET_CHANGES = 'reset.changes';
const DIALOG_RESET_BRANCH = 'reset.branch';
const DIALOG_RESET_OTHER = 'reset.other';
const DIALOG_TAG_CREATE = 'tag.create';
const DIALOG_TAG_DELETE = 'tag.delete';
const DIALOG_COMPARE = 'compare';
const DIALOG_STASH = 'stash';
const DIALOG_STASH_MANAGE = 'stash.manage';
const DIALOG_REMOTE_PUSH = 'remote.push';
const DIALOG_COMMIT_CHERRY_PICK = 'commit.cherry-pick';
const DIALOG_COMMIT_REVERT = 'commit.revert';
const DIALOG_COMMIT_ARCHIVE = 'commit.archive';
const DIALOG_COMMIT_REWORD = 'commit.reword';
const DIALOG_PATCH_FORMAT = 'patch.format';
const DIALOG_SUBMODULE_MANAGE = 'submodule.manage';
const DIALOG_WORKTREE_MANAGE = 'worktree.manage';
const DIALOG_WORKTREE_CREATE = 'worktree.create';
const DIALOG_FILE_IGNORE = 'file.ignore';
const DIALOG_FILE_MOVE = 'file.move';
const DIALOG_CONFLICTS_EDIT_FILE = 'conflicts.editFile';
const DIALOG_FILE_HISTORY = 'file.history';
const DIALOG_REPO_EDIT_FILE = 'repo.editFile';
const DIALOG_PATCH_VIEW = 'patch.view';
const DIALOG_SEARCH_GREP = 'search.grep';
const DIALOG_VIEW_ADVANCED_FILTER = 'view.advancedFilter';
const DIALOG_COMMAND_OUTPUT = 'commandOutput';

/** The props a dialog is mounted with, read out of the payload it was opened with. */
export function propsFor(name: DialogName, payload: DialogPayload): Record<string, unknown>
{
  switch (name)
  {
    case DIALOG_COMMAND_OUTPUT:
      // The runs to follow, minted before the first one started: see `OutputStep`.
      return { steps: payload.outputSteps ?? [], keepOpen: payload.outputKeepOpen === true };
    case DIALOG_BRANCH_CHECKOUT:
      return { gitRef: payload.ref, suggestedRef: payload.suggestedRef };
    case DIALOG_COMMIT_CHECKOUT:
      return { gitRef: payload.sha ?? payload.ref };
    case DIALOG_BRANCH_CREATE:
      return { startPoint: payload.sha ?? payload.ref };
    case DIALOG_BRANCH_RENAME:
      return { branchName: payload.branchName ?? '' };
    case DIALOG_BRANCH_SET_UPSTREAM:
      return { branchName: payload.branchName ?? '' };
    case DIALOG_BRANCH_DELETE:
      // Optional: the menu-bar row opens the list with nothing ticked, the panel's row opens it with the branch already chosen.
      return { branchName: payload.branchName };
    case DIALOG_BRANCH_DELETE_REMOTE:
      // Both optional and narrowing: a branch row names the branch and ticks it, a remote row names the remote and lists its branches with none ticked.
      return { gitRef: payload.ref, remoteName: payload.remoteName };
    case DIALOG_BRANCH_CLEANUP:
      // Acts on the repository, not one ref, so the path is the whole operand.
      return { repoPath: payload.repoPath ?? '' };
    case DIALOG_REMOTE_PULL:
      return {
        remoteName: payload.remoteName,
        gitRef: payload.ref,
        action: payload.pullAction,
        prune: payload.prune === true
      };
    case DIALOG_BRANCH_MERGE:
      return { gitRef: payload.ref };
    case DIALOG_BRANCH_REBASE:
      // The surface decides which controls open, not the dialog: three menu rows, one window, three states.
      return {
        onto: payload.ref,
        interactive: payload.rebaseInteractive === true,
        advanced: payload.rebaseAdvanced === true
      };
    case DIALOG_RESET_CHANGES:
      // Everything, or only what's not staged: the commit screen offers both rows.
      return { scope: payload.discardScope ?? 'all' };
    case DIALOG_RESET_BRANCH:
    case DIALOG_RESET_OTHER:
      return { commit: payload.sha ?? HEAD_REF };
    case DIALOG_TAG_CREATE:
      return { gitRef: payload.sha ?? HEAD_REF };
    case DIALOG_TAG_DELETE:
      return { tagName: payload.ref ?? '' };
    case DIALOG_COMPARE:
      // Both optional: opens HEAD against the working tree when a surface named neither, the useful thing to show someone who asked to compare without saying what.
      return { base: payload.compareBase, to: payload.compareTo };
    case DIALOG_STASH:
      // A mode rather than an operand: this window is always about the working tree, and
      // "Stash Staged Changes" is that same window with one box ticked.
      return { stagedOnly: payload.stagedOnly };
    case DIALOG_STASH_MANAGE:
      // Optional: a stash row names the one it was about, the Manage row names none and
      // the window opens on the newest.
      return { stashRef: payload.stashRef };
    case DIALOG_REMOTE_PUSH:
      // A tag opens the tags tab, a branch the branch one: same window, operand says
      // which. `failure` is git's own words from a push that failed in Commit and Push.
      return { branch: payload.ref, tagName: payload.tagName, failure: payload.pushRejection };
    case DIALOG_COMMIT_CHERRY_PICK:
      return { sha: payload.sha ?? '' };
    case DIALOG_COMMIT_REVERT:
      return { sha: payload.sha ?? '' };
    case DIALOG_COMMIT_ARCHIVE:
      return { sha: payload.sha ?? '' };
    case DIALOG_COMMIT_REWORD:
      // Only the SHA: the dialog reads the message from git itself, since a copy in the payload would be whatever was true when the menu was opened.
      return { sha: payload.sha ?? '' };
    case DIALOG_PATCH_FORMAT:
      // The grid's selection, when two commits were picked: the range is the whole point.
      return { from: payload.ref ?? '', to: payload.sha ?? HEAD_REF };
    case DIALOG_SUBMODULE_MANAGE:
      // Empty selects the "all submodules" row, what rows acting on every one want.
      return { selectPath: payload.filePath ?? '' };
    case DIALOG_WORKTREE_MANAGE:
      // Which row to open on: the panel's Delete Worktree row names one.
      return { selectPath: payload.filePath ?? '' };
    case DIALOG_WORKTREE_CREATE:
      // The branch the panel had selected, when a ref node opened it.
      return { gitRef: payload.ref ?? '' };
    case DIALOG_FILE_IGNORE:
    {
      // A list, even from a surface that named one file: the two menu rows both act on whatever the file list has selected, often several.
      let fromSingle: string[];
      if (payload.filePath)
      {
        fromSingle = [payload.filePath];
      }
      else
      {
        fromSingle = [];
      }
      return {
        filePaths: payload.filePaths ?? fromSingle,
        target: payload.ignoreTarget ?? REPO_TEXT_FILE_GITIGNORE
      };
    }
    case DIALOG_FILE_MOVE:
      return { filePath: payload.filePath ?? '' };
    case DIALOG_CONFLICTS_EDIT_FILE:
      return { filePath: payload.filePath ?? '' };
    case DIALOG_FILE_HISTORY:
    {
      // `sha` absent means the working tree, the common case from the changed-files list; a bare `HEAD` fallback would blame an uncommitted edit as already part of HEAD's commit.
      let revision: { kind: typeof ENDPOINT_KIND_COMMIT; sha: string } | null;
      if (payload.sha)
      {
        revision = { kind: ENDPOINT_KIND_COMMIT, sha: payload.sha };
      }
      else
      {
        revision = null;
      }
      return {
        filePath: payload.filePath ?? '',
        revision,
        tab: payload.fileHistoryTab ?? 'diff'
      };
    }
    case DIALOG_REPO_EDIT_FILE:
      // Two operands, one window: a named repository file, or a working file by path.
      // `filePath` is absent for all four repo files, which is what the dialog reads to tell the two apart.
      return {
        target: payload.repoTextFile ?? REPO_TEXT_FILE_GITIGNORE,
        filePath: payload.filePath
      };
    case DIALOG_PATCH_VIEW:
      // Optional, usually absent: the menu row opens the window empty and the file is chosen in it.
      return { filePath: payload.filePath ?? '' };
    case DIALOG_SEARCH_GREP:
    {
      // `sha` absent means the working tree, the same rule `file.history` above uses: a search started from the menu bar is about the code you have.
      let revision: { kind: typeof ENDPOINT_KIND_COMMIT; sha: string } | null;
      if (payload.sha)
      {
        revision = { kind: ENDPOINT_KIND_COMMIT, sha: payload.sha };
      }
      else
      {
        revision = null;
      }
      return { revision };
    }
    case DIALOG_VIEW_ADVANCED_FILTER:
      return { logFilter: payload.logFilter ?? {} };
    default:
      return {};
  }
}
