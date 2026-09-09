/**
 * The small questions a dialog asks about a repository before it can be filled in.
 * Each is one git read with a scalar answer, here rather than in the dialogs because a
 * renderer cannot spawn, and together because none is more than a few lines.
 */

import { CONFIG_SCOPE_EFFECTIVE, type RevisionSummary } from '@shared/types.js';
import { parseParents } from '@shared/parents.js';
import { readConfigValues } from './config.js';
import { GIT_KIND_READ, tryGit } from './runner.js';

const CMD_LOG = 'log';
const CMD_REV_LIST = 'rev-list';
const CMD_MERGE_BASE = 'merge-base';
const CMD_LS_REMOTE = 'ls-remote';
const CMD_CHECK_REF_FORMAT = 'check-ref-format';
const FLAG_LEFT_RIGHT = '--left-right';
const FLAG_COUNT = '--count';
const FLAG_IS_ANCESTOR = '--is-ancestor';
const FLAG_HEADS = '--heads';
const FLAG_LIMIT_ONE = '-1';
const FLAG_BRANCH = '--branch';
const REFS_HEADS_PREFIX = 'refs/heads/';
const HEAD_REF = 'HEAD';
const PATH_SEPARATOR = '--';

export interface AheadBehind {
  /** Commits in `ref` that HEAD does not have. */
  ahead: number;
  /** Commits HEAD has that `ref` does not. */
  behind: number;
}

/**
 * How far `ref` is from HEAD, in commits each way: `rev-list --left-right --count
 * HEAD...<ref>` gives both in one walk. Null on an unborn HEAD, missing ref, or no
 * merge base; uses `tryGit`, since a dialog failing to open is worse than one that omits this.
 */
export async function getAheadBehind(
  repoPath: string,
  ref: string,
  base = HEAD_REF
): Promise<AheadBehind | null>
{
  const out = await tryGit(repoPath, [
    CMD_REV_LIST,
    FLAG_LEFT_RIGHT,
    FLAG_COUNT,
    `${base}...${ref}`
  ]);
  if (out === null)
  {
    return null;
  }

  // Two counts separated by a tab: "<behind>\t<ahead>" reading left as the base's side.
  const [left, right] = out.trim().split(/\s+/);
  const behind = Number(left);
  const ahead = Number(right);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead))
  {
    return null;
  }
  return { ahead, behind };
}

/**
 * Whether `ancestor` is contained in `descendant`: `merge-base --is-ancestor` answers
 * by exit code alone, so "no" and "ref doesn't exist" are the same answer here, both
 * meaning don't promise the user a fast-forward.
 */
export async function isAncestor(
  repoPath: string,
  ancestor: string,
  descendant: string
): Promise<boolean>
{
  return (
    (await tryGit(repoPath, [CMD_MERGE_BASE, FLAG_IS_ANCESTOR, ancestor, descendant])) !== null
  );
}

/**
 * The branches a remote currently has, without fetching (`ls-remote --heads`): how the
 * push dialog tells "this branch exists there" from "this would create it". An empty
 * list is also the answer when unreachable: offline shouldn't stop a dialog opening.
 */
export async function listRemoteHeads(repoPath: string, remote: string): Promise<string[]>
{
  const out = await tryGit(repoPath, [CMD_LS_REMOTE, FLAG_HEADS, remote]);
  if (out === null)
  {
    return [];
  }

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t')[1] ?? '')
    .filter((ref) => ref.startsWith(REFS_HEADS_PREFIX))
    .map((ref) => ref.slice(REFS_HEADS_PREFIX.length));
}

/**
 * What a revision actually is, in one line: a dialog window has no grid to look its
 * operand up in, and forty hex characters is not something anyone can confirm before
 * pressing a button. `log -1`, not `show -s`, since it peels an annotated tag to the
 * commit it points at. Null when the revision doesn't resolve.
 */
export async function getRevisionSummary(
  repoPath: string,
  rev: string
): Promise<RevisionSummary | null>
{
  const out = await tryGit(repoPath, [
    CMD_LOG,
    FLAG_LIMIT_ONE,
    '--format=%H%x00%h%x00%s%x00%an%x00%ct',
    rev,
    PATH_SEPARATOR
  ]);
  if (out === null)
  {
    return null;
  }

  const [sha, shortSha, subject, author, date] = out.split('\0');
  if (!sha || !shortSha)
  {
    return null;
  }
  return {
    sha,
    shortSha,
    subject: subject ?? '',
    author: author ?? '',
    // The last field carries `log`'s trailing newline; a repository with no commits gives NaN, and 0 is the honest "unknown".
    date: Number(date?.trim()) || 0
  };
}

/**
 * A commit's message in full, exactly as stored. `getRevisionSummary` carries only the
 * subject, enough to confirm which commit; rewording needs the whole thing. `%B`, not
 * `%s%n%n%b`: the raw message, so existing trailing structure survives unreassembled.
 */
export async function getCommitMessage(repoPath: string, rev: string): Promise<string>
{
  const out = await tryGit(repoPath, [CMD_LOG, FLAG_LIMIT_ONE, '--format=%B', rev, PATH_SEPARATOR]);
  // `log` adds its own trailing newline, on top of the message's usual one, so the box
  // would open on blank lines the user has to delete.
  if (out === null)
  {
    return '';
  }
  else
  {
    return out.replace(/\n+$/, '');
  }
}

/**
 * The commits a revision has as parents, in git's own order: what makes cherry-pick or
 * revert need `-m <n>` when there are two or more. Two reads: `%P` for the SHAs, then a
 * `--no-walk=unsorted` `log` to describe them, since plain `--no-walk` sorts by date and
 * would silently swap which parent `-m 1` means.
 */
export async function getParentRevisions(
  repoPath: string,
  sha: string
): Promise<RevisionSummary[]>
{
  const printed = await tryGit(repoPath, [
    CMD_LOG,
    FLAG_LIMIT_ONE,
    '--format=%P',
    sha,
    PATH_SEPARATOR
  ]);
  const parents = parseParents(printed ?? '');
  if (!parents.length)
  {
    return [];
  }

  const out = await tryGit(repoPath, [
    CMD_LOG,
    '--no-walk=unsorted',
    '--format=%H%x00%h%x00%s%x00%an%x00%ct%x00',
    ...parents,
    PATH_SEPARATOR
  ]);
  if (out === null)
  {
    return [];
  }

  // Five fields and a NUL terminator per commit, split on the newline git writes between records.
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
    {
      const [id, shortSha, subject, author, date] = line.split('\0');
      return {
        sha: id ?? '',
        shortSha: shortSha ?? '',
        subject: subject ?? '',
        author: author ?? '',
        date: Number(date) || 0
      };
    })
    .filter((entry) => entry.sha.length > 0);
}

/**
 * Whether git would accept `name` as a branch name: `check-ref-format --branch` is
 * git's own answer, avoiding a second implementation of its (long) rules. An empty name
 * is refused without asking, since git's usage error for it isn't the message it prints for the rest.
 */
export async function isValidBranchName(repoPath: string, name: string): Promise<boolean>
{
  if (name.trim().length === 0)
  {
    return false;
  }
  // A read: it validates a name and touches nothing.
  return (
    (await tryGit(repoPath, [CMD_CHECK_REF_FORMAT, FLAG_BRANCH, name], {
      kind: GIT_KIND_READ
    })) !== null
  );
}

/**
 * Effective config values, as git resolves them: repository over global over system.
 * Several keys per call, since the dialogs that want them want several at once. A key
 * that isn't set comes back missing, not `''`: unset and false are different answers.
 */
export async function getConfigValues(
  repoPath: string,
  keys: string[]
): Promise<Record<string, string>>
{
  return readConfigValues(repoPath, CONFIG_SCOPE_EFFECTIVE, keys);
}
