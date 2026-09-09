/**
 * The repository as a whole: opening and picking one, what it currently is, watching it
 * for changes made outside the app, the objects it holds, and the small facts a dialog
 * asks before it can be filled in.
 */

import { dialog, shell } from 'electron';
import { noteRepository } from '@main/diagnostics/index.js';
import { openTerminal, revealInFinder } from '@main/externalOpen.js';
import {
  ownerWindow
} from '@main/dialogs.js';
import { createWindow } from '@main/windows.js';
import {
  getAheadBehind,
  getCommitMessage,
  getConfigValues,
  getParentRevisions,
  getRevisionSummary,
  isAncestor,
  isValidBranchName,
  listRemoteHeads
} from '@main/git/facts.js';
import { readConfigValues, writeConfigValue } from '@main/git/config.js';
import { listTreeFiles, readBlob } from '@main/git/tree.js';
import { listStaleBranches } from '@main/git/branchCleanup.js';
import { deleteIndexLock } from '@main/git/maintenance.js';
import { runFsck } from '@main/git/fsck.js';
import { readPatchFile } from '@main/git/patchFile.js';
import { listMergedRefs, listRefs } from '@main/git/refs.js';
import { listRemotes } from '@main/git/remote.js';
import { getRepoInfo, getRepoState, getStatus, resolveWatchedGitDirs } from '@main/git/repo.js';
import { listStashes } from '@main/git/stash.js';
import { listSubmodules, submoduleStatus } from '@main/git/submodule.js';
import { listWorktrees } from '@main/git/worktree.js';
import { forgetRecentRepo, recordRecentRepo } from '@main/settings.js';
import { unwatchRepo, watchRepo } from '@main/watcher.js';
import {
  changed,
  handle,
  handleFromWindow,
  handleWrite
} from '../register.js';

export function registerRepoHandlers(): void
{
  // ── Repository ──────────────────────────────────────────────────────────────
  handle('repo:open', async (path) =>
  {
    const info = await getRepoInfo(path);
    if (info)
    {
      recordRecentRepo(info.path);
      // The shape, not just the path: "bare" and "in a worktree" are the two facts that
      // make half of this app's edge cases reproducible, and neither is in the argv of
      // anything that follows.
      const shape = [`branch ${info.branch ?? '(detached)'}`, `head ${info.head ?? '(unborn)'}`];
      if (info.isBare)
      {
        shape.push('bare');
      }
      if (info.superprojectPath)
      {
        shape.push(`submodule of ${info.superprojectPath}`);
      }
      noteRepository(info.path, shape);
    }
    return info;
  });

  handle('repo:pick', async () =>
  {
    const result = await dialog.showOpenDialog({
      title: 'Open Repository',
      properties: ['openDirectory']
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked)
    {
      return null;
    }

    const info = await getRepoInfo(picked);
    if (info)
    {
      recordRecentRepo(info.path);
    }
    return info;
  });

  handle('repo:info', (repoPath) => getRepoInfo(repoPath));
  handle('repo:state', (repoPath) => getRepoState(repoPath));
  handle('repo:status', (repoPath) => getStatus(repoPath));

  handle('repo:watch', async (repoPath) =>
  {
    watchRepo(repoPath, await resolveWatchedGitDirs(repoPath));
  });
  handle('repo:unwatch', (repoPath) => unwatchRepo(repoPath));
  // To the *owner*: a dialog asking for this means the repository window behind it, the one with a grid.
  handleFromWindow('repo:openHere', (sender, path) =>
  {
    const owner = ownerWindow(sender);
    if (owner && !owner.isDestroyed())
    {
      owner.webContents.send('event:openRepo', path);
    }
  });
  handle('repo:forgetRecent', (path) => forgetRecentRepo(path).recentRepos);
  handle('repo:openWindow', (path) =>
  {
    createWindow(path);
  });

  handle('repo:openPath', async (path) =>
  {
    // `openPath` reports a refusal by *resolving* with the message rather than rejecting,
    // so an unread result is a click that does nothing and says nothing: the same silence
    // a reveal used to answer a path no longer on disk with.
    const failure = await shell.openPath(path);
    if (failure)
    {
      throw new Error(failure);
    }
  });
  handle('repo:showItemInFolder', (path) => revealInFinder(path));
  handle('repo:openTerminal', (path) => openTerminal(path));


  // ── The tree at a revision ──────────────────────────────────────────────────
  handle('tree:list', (repoPath, endpoint) => listTreeFiles(repoPath, endpoint));
  handle('tree:blob', (repoPath, endpoint, entry) => readBlob(repoPath, endpoint, entry));


  // ── Repository objects ──────────────────────────────────────────────────────
  handle('refs:list', (repoPath) => listRefs(repoPath));
  handle('refs:merged', (repoPath, commit) => listMergedRefs(repoPath, commit));
  handle('branch:stale', (repoPath, comparison) => listStaleBranches(repoPath, comparison));
  handle('remote:list', (repoPath) => listRemotes(repoPath));
  handle('stash:list', (repoPath) => listStashes(repoPath));
  handle('worktree:list', (repoPath) => listWorktrees(repoPath));
  handle('submodule:list', (repoPath) => listSubmodules(repoPath));
  handle('submodule:status', (repoPath) => submoduleStatus(repoPath));


  // ── Facts a dialog needs ────────────────────────────────────────────────────
  handle('repo:aheadBehind', (repoPath, ref, base) => getAheadBehind(repoPath, ref, base));
  handle('repo:isAncestor', (repoPath, ancestor, descendant) =>
    isAncestor(repoPath, ancestor, descendant)
  );
  handle('remote:heads', (repoPath, remote) => listRemoteHeads(repoPath, remote));
  handle('repo:revision', (repoPath, rev) => getRevisionSummary(repoPath, rev));
  handle('repo:commitMessage', (repoPath, rev) => getCommitMessage(repoPath, rev));
  handle('repo:parents', (repoPath, sha) => getParentRevisions(repoPath, sha));
  handle('repo:validBranchName', (repoPath, name) => isValidBranchName(repoPath, name));
  handle('repo:config', (repoPath, keys) => getConfigValues(repoPath, keys));

  handle('config:read', (repoPath, scope, keys) => readConfigValues(repoPath, scope, keys));
  // The one write registered with `handle`, not `handleWrite`: a `--global` write with
  // no repository open has nothing for `handleWrite`'s `changed(args[0])` to announce to.
  handle('config:write', async (repoPath, scope, key, value) =>
  {
    try
    {
      await writeConfigValue(repoPath, scope, key, value);
    }
    finally
    {
      if (repoPath)
      {
        changed(repoPath, ['config']);
      }
    }
  });

  // `index`: whatever git was doing when it died holding this lock, the index on disk is that half-finished write.
  handleWrite('repo:deleteIndexLock', ['index'], (repoPath) => deleteIndexLock(repoPath));

  handle('repo:fsck', (repoPath, options) => runFsck(repoPath, options));

  // No repository argument: a patch someone sent you is wherever they sent it to.
  handle('file:readPatch', (path) => readPatchFile(path));

}
