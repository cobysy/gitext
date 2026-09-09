/**
 * Read repository contents at one endpoint and one file from it (sibling of diff.ts for "what was here").
 */

import { ENDPOINT_KIND_COMMIT, ENDPOINT_KIND_WORKING_TREE, type DiffEndpoint } from '@shared/diff.js';
import { isSubmoduleMode } from '@shared/mode.js';
import { buildTreeArgs, type BlobContents, type TreeEntry } from '@shared/tree.js';
import { OBJECT_KIND_BLOB, OBJECT_KIND_SUBMODULE } from '@shared/types.js';
import { BINARY_SNIFF_BYTES, MAX_GIT_OUTPUT_BYTES } from './constants.js';
import { readFileAt } from './file.js';
import { parseLsFilesStage, parseLsTree, splitNul } from './parse.js';
import { ENCODING_UTF8, GIT_KIND_READ, GitError, runGit } from './runner.js';

// Git commands and flags
const CMD_LS_FILES = 'ls-files';
const FLAG_DELETED = '--deleted';
const FLAG_OTHERS = '--others';
const FLAG_EXCLUDE_STANDARD = '--exclude-standard';
const FLAG_NUL_TERMINATED = '-z';

/** Paths git tracks but that are not on disk right now. */
async function listDeleted(repoPath: string): Promise<Set<string>>
{
  const out = await runGit(repoPath, [CMD_LS_FILES, FLAG_DELETED, FLAG_NUL_TERMINATED], {
    kind: GIT_KIND_READ
  });
  return new Set(splitNul(out));
}

/** Paths on disk that git does not track and is not ignoring. */
async function listUntracked(repoPath: string): Promise<TreeEntry[]>
{
  const out = await runGit(
    repoPath,
    [CMD_LS_FILES, FLAG_OTHERS, FLAG_EXCLUDE_STANDARD, FLAG_NUL_TERMINATED],
    { kind: GIT_KIND_READ }
  );
  // No mode: an untracked file has no index entry to carry one, and the tree list draws
  // the mode nowhere: it only asks whether an entry is a submodule, and this is not one.
  return splitNul(out).map((path) => ({ path, kind: OBJECT_KIND_BLOB, mode: '' }));
}

/**
 * Everything at an endpoint, sorted the way a tree reads.
 *
 * A commit is one read. The working tree is three, because the index is only most of the
 * answer: a file staged for deletion but still on disk is in neither, a file deleted on
 * disk is in the index and not in the working tree, and an untracked file is in the
 * working tree and in no index at all. Getting that wrong would put a row in the list
 * that cannot be opened, which is the one failure a file tree must not have.
 */
export async function listTreeFiles(
  repoPath: string,
  endpoint: DiffEndpoint
): Promise<TreeEntry[]>
{
  const out = await runGit(repoPath, buildTreeArgs(endpoint), { kind: GIT_KIND_READ });
  let entries;
  if (endpoint.kind === ENDPOINT_KIND_COMMIT)
  {
    entries = parseLsTree(out);
  }
  else
  {
    entries = parseLsFilesStage(out);
  }

  if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
  {
    const [deleted, untracked] = await Promise.all([
      listDeleted(repoPath),
      listUntracked(repoPath)
    ]);
    const kept = entries.filter((entry) => !deleted.has(entry.path));
    // A path can only appear once: untracked means it is in no index, and the index is
    // where everything above came from.
    kept.push(...untracked);
    return kept.sort((a, b) => a.path.localeCompare(b.path));
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * "That path is not at this endpoint", in git's several spellings and the disk's one.
 * Not the transient family in `runner/readRetry.ts`: a retry answers the same.
 */
const PATH_ABSENT_STDERR = /^fatal: path .*(does not exist|exists on disk, but not)/;
const ERRNO_NO_SUCH_FILE = 'ENOENT';

function isPathAbsent(err: unknown): boolean
{
  if (err instanceof GitError)
  {
    return PATH_ABSENT_STDERR.test(err.stderr.trim());
  }
  return (err as NodeJS.ErrnoException | null)?.code === ERRNO_NO_SUCH_FILE;
}

/**
 * One file's contents at an endpoint, as text where that means anything.
 *
 * Read as bytes and decoded here rather than by the runner, for the reason `readFileAt`
 * exists at all: a blob may be an image, and decoding one as UTF-8 replaces every invalid
 * sequence, which would show as a wall of replacement characters rather than as "this is
 * a binary file". The sniff happens before the decode, so a binary file is never decoded.
 */
export async function readBlob(
  repoPath: string,
  endpoint: DiffEndpoint,
  entry: TreeEntry
): Promise<BlobContents>
{
  const base = {
    path: entry.path,
    text: '',
    size: 0,
    binary: false,
    truncated: false,
    missing: false
  };

  // A gitlink has no blob behind it: `git show <sha>:<path>` prints the submodule's
  // commit line, which is not the file anyone clicked for. Say what it is instead.
  if (entry.kind === OBJECT_KIND_SUBMODULE || isSubmoduleMode(entry.mode))
  {
    return { ...base, submodule: true };
  }

  let bytes: Buffer;
  try
  {
    bytes = await readFileAt(repoPath, endpoint, entry.path);
  }
  catch (err)
  {
    if (!isPathAbsent(err))
    {
      throw err;
    }
    return { ...base, submodule: false, missing: true };
  }

  const head = bytes.subarray(0, BINARY_SNIFF_BYTES);
  if (head.includes(0))
  {
    return { ...base, size: bytes.length, binary: true, submodule: false };
  }

  const truncated = bytes.length > MAX_GIT_OUTPUT_BYTES;
  let shown: Buffer;
  if (truncated)
  {
    shown = bytes.subarray(0, MAX_GIT_OUTPUT_BYTES);
  }
  else
  {
    shown = bytes;
  }
  return {
    path: entry.path,
    text: shown.toString(ENCODING_UTF8),
    size: bytes.length,
    binary: false,
    truncated,
    submodule: false,
    missing: false
  };
}
