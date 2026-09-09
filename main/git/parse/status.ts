import {
  FILE_STATUS_CONFLICTED,
  FILE_STATUS_IGNORED,
  FILE_STATUS_UNKNOWN,
  FILE_STATUS_UNTRACKED,
  type FileStatusCode,
  type WorkingTreeStatus
} from '@shared/types.js';
import { splitNul } from './common.js';

// Status characters from `git status --porcelain=v2`
const STATUS_ADDED = 'A';
const STATUS_MODIFIED = 'M';
const STATUS_DELETED = 'D';
const STATUS_RENAMED = 'R';
const STATUS_COPIED = 'C';
const STATUS_TYPECHANGE = 'T';
const STATUS_CONFLICTED = 'U';
const STATUS_UNTRACKED = '?';
const STATUS_IGNORED = '!';
const STATUS_UNKNOWN = '.';
const STATUS_CLEAN = ' ';

// Branch header keys
const BRANCH_HEAD = 'branch.head';
const BRANCH_UPSTREAM = 'branch.upstream';
const BRANCH_AHEAD_BEHIND = 'branch.ab';
const BRANCH_DETACHED = '(detached)';

// Record type markers
const RECORD_ORDINARY = '1';
const RECORD_RENAME = '2';
const RECORD_CONFLICT = 'u';

// Field indicators
const SUBMODULE_PREFIX = 'S';
const BRANCH_HEADER_PREFIX = '# ';

/** Map a `git status --porcelain=v2` XY character to a status code. */
function statusCharToCode(char: string): FileStatusCode
{
  switch (char)
  {
    case STATUS_ADDED:
      return 'added';
    case STATUS_MODIFIED:
      return 'modified';
    case STATUS_DELETED:
      return 'deleted';
    case STATUS_RENAMED:
      return 'renamed';
    case STATUS_COPIED:
      return 'copied';
    case STATUS_TYPECHANGE:
      return 'typechange';
    case STATUS_CONFLICTED:
      return FILE_STATUS_CONFLICTED;
    case STATUS_UNKNOWN:
    case STATUS_CLEAN:
      return FILE_STATUS_UNKNOWN;
    default:
      return FILE_STATUS_UNKNOWN;
  }
}

/**
 * Parse `git status --porcelain=v2 --branch -z`. v2 includes branch/upstream/ahead-behind
 * inline, avoiding extra subprocesses. Record types: 1=ordinary, 2=rename, u=unmerged,
 * ?=untracked, !=ignored. XY: X=staged, Y=unstaged; A/M/D/R/C/T/U=change type.
 */
export function parseStatus(text: string): WorkingTreeStatus
{
  const result: WorkingTreeStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: []
  };

  const entries = splitNul(text);

  for (let i = 0; i < entries.length; i++)
  {
    const entry = entries[i];
    if (!entry)
    {
      continue;
    }

    if (entry.startsWith(BRANCH_HEADER_PREFIX))
    {
      parseBranchHeader(entry, result);
      continue;
    }

    const kind = entry[0];

    switch (kind)
    {
      case RECORD_ORDINARY:
      case RECORD_RENAME:
      {
        const fields = entry.split(' ');
        const xy = fields[1] ?? '..';
        const isRename = kind === RECORD_RENAME;
        // Path at field 8 (ordinary) or 9 (rename, after score).
        let pathStart;
        if (isRename)
        {
          pathStart = 9;
        }
        else
        {
          pathStart = 8;
        }
        const path = fields.slice(pathStart).join(' ');
        // Rename: original at next NUL-separated element.
        let origPath;
        if (isRename)
        {
          origPath = entries[++i];
        }
        else
        {
          origPath = undefined;
        }

        const index = statusCharToCode(xy[0] ?? STATUS_UNKNOWN);
        const worktree = statusCharToCode(xy[1] ?? STATUS_UNKNOWN);
        result.files.push({
          path,
          origPath,
          index,
          worktree,
          staged: index !== FILE_STATUS_UNKNOWN,
          unstaged: worktree !== FILE_STATUS_UNKNOWN,
          isSubmodule: (fields[2] ?? '').startsWith(SUBMODULE_PREFIX)
        });
        continue;
      }
      case RECORD_CONFLICT:
      {
        const fields = entry.split(' ');
        const path = fields.slice(10).join(' ');
        result.files.push({
          path,
          index: FILE_STATUS_CONFLICTED,
          worktree: FILE_STATUS_CONFLICTED,
          staged: false,
          unstaged: true,
          isSubmodule: (fields[2] ?? '').startsWith(SUBMODULE_PREFIX)
        });
        continue;
      }
      case STATUS_UNTRACKED:
      case STATUS_IGNORED:
      {
        let code: FileStatusCode;
        if (kind === STATUS_UNTRACKED)
        {
          code = FILE_STATUS_UNTRACKED;
        }
        else
        {
          code = FILE_STATUS_IGNORED;
        }
        result.files.push({
          path: entry.slice(2),
          index: FILE_STATUS_UNKNOWN,
          worktree: code,
          staged: false,
          unstaged: true,
          isSubmodule: false
        });
        break;
      }
      default:
        break;
    }
  }

  return result;
}

function parseBranchHeader(entry: string, result: WorkingTreeStatus): void
{
  const [, key, ...rest] = entry.split(' ');
  const value = rest.join(' ');

  switch (key)
  {
    case BRANCH_HEAD:
      if (value === BRANCH_DETACHED)
      {
        result.branch = null;
      }
      else
      {
        result.branch = value;
      }
      break;
    case BRANCH_UPSTREAM:
      result.upstream = value;
      break;
    case BRANCH_AHEAD_BEHIND: {
      // Format: "+3 -2" (ahead, behind).
      const match = /\+(\d+) -(\d+)/.exec(value);
      if (match)
      {
        result.ahead = Number(match[1]);
        result.behind = Number(match[2]);
      }
      break;
    }
  }
}
