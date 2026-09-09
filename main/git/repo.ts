/**
 * Repository identity and state. `getRepoState` is the cross-cutting one: every
 * mutating command reports it back so the renderer's `afterGitOperation` hook can
 * decide whether to offer conflict resolution, a rebase continue, or nothing at all.
 */

import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { InProgressOperation, RepoInfo, RepoState, WorkingTreeStatus } from '@shared/types.js';
import { parseStatus, parseUnmergedPaths } from './parse.js';
import { GIT_KIND_READ, runGit, tryGit } from './runner.js';

const CMD_REV_PARSE = 'rev-parse';
const CMD_SYMBOLIC_REF = 'symbolic-ref';
const CMD_LS_FILES = 'ls-files';
const CMD_STATUS = 'status';
const FLAG_SHOW_TOPLEVEL = '--show-toplevel';
const FLAG_IS_BARE = '--is-bare-repository';
const FLAG_ABSOLUTE_GIT_DIR = '--absolute-git-dir';
const FLAG_GIT_COMMON_DIR = '--git-common-dir';
const FLAG_SHOW_SUPERPROJECT = '--show-superproject-working-tree';
const FLAG_QUIET = '--quiet';
const FLAG_SHORT = '--short';
const FLAG_UNMERGED = '-u';
const FLAG_NUL_TERMINATED = '-z';
const FLAG_PORCELAIN_V2 = '--porcelain=v2';
const GIT_BOOL_TRUE = 'true';
const FLAG_BRANCH = '--branch';
const FLAG_UNTRACKED_ALL = '--untracked-files=all';
const HEAD_REF = 'HEAD';
const GIT_DIR_NAME = '.git';

/** Identify the repository containing `path`. Returns null when the path isn't inside a working tree, distinguishing "not a repo" from "something went wrong". */
export async function getRepoInfo(path: string): Promise<RepoInfo | null>
{
  const start = resolve(path);
  if (!existsSync(start))
  {
    return null;
  }

  /**
   * Both in one `rev-parse`, and this pair before anything else, because it is the pair
   * that answers *anywhere* inside a repository. `--show-toplevel` is fatal in a bare
   * one, not empty, so asking it first made every bare repository read as "not a
   * repository" at all. Failing here is the honest form of that answer: outside a
   * repository this is the call that says so.
   */
  const identity = await tryGit(start, [CMD_REV_PARSE, FLAG_IS_BARE, FLAG_ABSOLUTE_GIT_DIR]);
  if (identity === null)
  {
    return null;
  }
  const [bareRaw, gitDirRaw] = identity.split('\n');
  const isBare = bareRaw?.trim() === GIT_BOOL_TRUE;

  const [topRaw, branchRaw, headRaw, superRaw] = await Promise.all([
    // A bare repository has no working tree to name, and asking is an error, not a blank.
    topLevelOf(start, isBare),
    // Empty output means detached HEAD; `--quiet` keeps that off stderr.
    tryGit(start, [CMD_SYMBOLIC_REF, FLAG_QUIET, FLAG_SHORT, HEAD_REF]),
    // Full, not `--short`: the artificial working-tree and index rows parent onto HEAD, and the grid matches those parents against the log's full SHAs.
    tryGit(start, [CMD_REV_PARSE, HEAD_REF]),
    tryGit(start, [CMD_REV_PARSE, FLAG_SHOW_SUPERPROJECT])
  ]);

  // A bare repository's root is the directory it was opened at: there is no other.
  const root = topRaw?.trim() || start;

  return {
    path: root,
    name: basename(root),
    gitDir: gitDirRaw?.trim() || join(root, GIT_DIR_NAME),
    branch: branchRaw?.trim() || null,
    head: headRaw?.trim() || null,
    isBare,
    superprojectPath: superRaw?.trim() || null
  };
}

/** The working tree's root, or null where there is no working tree to have one. */
async function topLevelOf(start: string, isBare: boolean): Promise<string | null>
{
  if (isBare)
  {
    return null;
  }
  return tryGit(start, [CMD_REV_PARSE, FLAG_SHOW_TOPLEVEL]);
}

/**
 * The repository's real git directory. `rev-parse --absolute-git-dir`, not
 * `join(repoPath, '.git')`: the two only agree for an ordinary clone. In a worktree
 * `.git` is a *file* pointing elsewhere; in a submodule the directory lives under the
 * superproject's `.git/modules/`. The fallback covers the read itself failing.
 */
export async function resolveGitDir(repoPath: string): Promise<string>
{
  const gitDir = (await tryGit(repoPath, [CMD_REV_PARSE, FLAG_ABSOLUTE_GIT_DIR]))?.trim();
  return gitDir || join(repoPath, GIT_DIR_NAME);
}

/**
 * The git directory **shared** by every worktree of this repository. Not the same as
 * `resolveGitDir`: in a linked worktree `--absolute-git-dir` is
 * `…/.git/worktrees/<name>`, holding that worktree's own `HEAD`/`index`, while
 * `config`/`info/exclude`/objects/refs live one level up. `--git-common-dir` answers
 * relative to cwd in an ordinary clone and absolutely in a worktree, so it's resolved rather than used as given.
 */
export async function resolveCommonGitDir(repoPath: string): Promise<string>
{
  const common = (await tryGit(repoPath, [CMD_REV_PARSE, FLAG_GIT_COMMON_DIR]))?.trim();
  if (common)
  {
    return resolve(repoPath, common);
  }
  else
  {
    return join(repoPath, GIT_DIR_NAME);
  }
}

/**
 * Every git directory this repository's state can move in: what the watcher has to watch
 * to see a change made outside the app. Two of them only in a linked worktree, where
 * `HEAD`, `index` and any in-progress operation live in that worktree's own directory
 * while refs, `config` and `packed-refs` live in the shared one. Watching either alone
 * leaves half the repository invisible.
 */
export async function resolveWatchedGitDirs(repoPath: string): Promise<string[]>
{
  const [gitDir, commonDir] = await Promise.all([
    resolveGitDir(repoPath),
    resolveCommonGitDir(repoPath)
  ]);
  if (gitDir === commonDir)
  {
    return [gitDir];
  }
  else
  {
    return [gitDir, commonDir];
  }
}

/** Detect which multi-step operation git is part-way through, plus any conflicts. Reads marker paths under `.git` rather than shelling out, what git itself does. */
export async function getRepoState(repoPath: string): Promise<RepoState>
{
  const dir = await resolveGitDir(repoPath);

  const unmerged = await tryGit(repoPath, [CMD_LS_FILES, FLAG_UNMERGED, FLAG_NUL_TERMINATED]);
  let conflictedPaths: string[];
  if (unmerged)
  {
    conflictedPaths = parseUnmergedPaths(unmerged);
  }
  else
  {
    conflictedPaths = [];
  }

  return {
    operation: detectOperation(dir),
    conflictCount: conflictedPaths.length,
    conflictedPaths
  };
}

function detectOperation(gitDir: string): InProgressOperation
{
  const has = (...parts: string[]): boolean => existsSync(join(gitDir, ...parts));

  // Since git 2.26 the merge backend handles *all* rebases, so `rebase-merge/` is
  // present for a plain `git rebase` too and can't tell interactive apart; both report as
  // 'rebase'. `git am` and `rebase --apply` share `rebase-apply/`; only `am` writes `applying` inside it.
  if (has('rebase-merge'))
  {
    return 'rebase';
  }
  if (has('rebase-apply'))
  {
    if (has('rebase-apply', 'applying'))
    {
      return 'am';
    }
    else
    {
      return 'rebase';
    }
  }
  if (has('CHERRY_PICK_HEAD'))
  {
    return 'cherry-pick';
  }
  if (has('REVERT_HEAD'))
  {
    return 'revert';
  }
  if (has('MERGE_HEAD'))
  {
    return 'merge';
  }
  if (has('BISECT_LOG'))
  {
    return 'bisect';
  }
  return 'none';
}

/** Read the working-tree status, including branch and ahead/behind, in one call. */
export async function getStatus(repoPath: string): Promise<WorkingTreeStatus>
{
  const out = await runGit(
    repoPath,
    [CMD_STATUS, FLAG_PORCELAIN_V2, FLAG_BRANCH, FLAG_UNTRACKED_ALL, FLAG_NUL_TERMINATED],
    { kind: GIT_KIND_READ }
  );
  return parseStatus(out);
}
