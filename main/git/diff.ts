/**
 * Reading diffs, which files changed, and the patch for one of them.
 * The argv comes from `shared/diff.ts` so what the file list shows is reproducible from what you typed.
 */

import {
  buildDiffArgs,
  buildUntrackedPatchArgs,
  compareDiffFiles,
  ENDPOINT_KIND_WORKING_TREE,
  type DiffFileEntry,
  type DiffOptions,
  type DiffPatch,
  type DiffRange
} from '@shared/diff.js';
import { OBJECT_KIND_BLOB, FILE_STATUS_UNTRACKED } from '@shared/types.js';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BINARY_SNIFF_BYTES, MAX_GIT_OUTPUT_BYTES } from './constants.js';
import { parseDiffRaw, splitNul } from './parse.js';
import { GIT_KIND_READ, runGit } from './runner.js';

const CMD_LS_FILES = 'ls-files';
const FLAG_OTHERS = '--others';
const FLAG_IGNORED = '--ignored';
const FLAG_EXCLUDE_STANDARD = '--exclude-standard';
const FLAG_DIRECTORY = '--directory';
const FLAG_NUL_TERMINATED = '-z';
const STATUS_IGNORED = 'ignored';
const DIFF_MODE_NAMES = 'names';
const DIFF_MODE_PATCH = 'patch';

/** True when either side of the comparison is the working tree on disk. */
function touchesWorkingTree(range: DiffRange): boolean
{
  return (
    range.from?.kind === ENDPOINT_KIND_WORKING_TREE || range.to.kind === ENDPOINT_KIND_WORKING_TREE
  );
}

const NEWLINE = 0x0a;

/** How many files are read at once: enough to keep the disk busy, not enough to hold a working tree in memory. */
const READ_AT_ONCE = 16;

/** The lines in a file, counted as git counts them: a last line without a newline still counts. */
function countLines(bytes: Buffer): number
{
  if (bytes.length === 0)
  {
    return 0;
  }
  let lines = 0;
  for (let at = bytes.indexOf(NEWLINE); at !== -1; at = bytes.indexOf(NEWLINE, at + 1))
  {
    lines++;
  }
  if (bytes[bytes.length - 1] !== NEWLINE)
  {
    lines++;
  }
  return lines;
}

/**
 * What an untracked file would add, since no diff will say. git counts a wholly new file
 * as its own lines, and answers that only one file at a time (`diff --no-index` takes a
 * pair of paths), so a working tree of new files would be a subprocess each: reading the
 * file here is the same answer for one syscall.
 *
 * A NUL byte near the start is binary to git, which counts nothing for it, and neither
 * does anything unreadable: gone since the listing, or not ours to read. The row is still
 * a row, with no counts on it.
 */
async function measureUntracked(
  repoPath: string,
  path: string
): Promise<Pick<DiffFileEntry, 'binary' | 'lines'>>
{
  const full = join(repoPath, path);
  try
  {
    // Read nothing enormous to say "+400000": a file past the output cap keeps its row and loses its counts.
    const { size } = await stat(full);
    if (size > MAX_GIT_OUTPUT_BYTES)
    {
      return { binary: false };
    }
    const bytes = await readFile(full);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0))
    {
      return { binary: true };
    }
    return { binary: false, lines: { added: countLines(bytes), deleted: 0 } };
  }
  catch
  {
    return { binary: false };
  }
}

/** Measure a listing, a handful at a time rather than a working tree's worth at once. */
async function measureAll(repoPath: string, entries: DiffFileEntry[]): Promise<void>
{
  for (let at = 0; at < entries.length; at += READ_AT_ONCE)
  {
    const batch = entries.slice(at, at + READ_AT_ONCE);
    const measured = await Promise.all(batch.map((entry) => measureUntracked(repoPath, entry.path)));
    batch.forEach((entry, index) => Object.assign(entry, measured[index]));
  }
}

/**
 * Files untracked right now, which no diff will ever mention.
 * Untracked files are part of working tree changes even though `git diff` omits them.
 */
async function listUntracked(
  repoPath: string,
  options: { ignored?: boolean } = {}
): Promise<DiffFileEntry[]>
{
  // `--exclude-standard` excludes build artifacts; `--ignored` replaces it to list ignored files instead.
  let args;
  if (options.ignored)
  {
    args = [CMD_LS_FILES, FLAG_OTHERS, FLAG_IGNORED, FLAG_EXCLUDE_STANDARD, FLAG_DIRECTORY, FLAG_NUL_TERMINATED];
  }
  else
  {
    args = [CMD_LS_FILES, FLAG_OTHERS, FLAG_EXCLUDE_STANDARD, FLAG_NUL_TERMINATED];
  }
  const out = await runGit(repoPath, args, {
    kind: GIT_KIND_READ
  });
  // An untracked file is in no index and no tree, so it has no mode to report.
  let status: DiffFileEntry['status'];
  if (options.ignored)
  {
    status = STATUS_IGNORED;
  }
  else
  {
    status = FILE_STATUS_UNTRACKED;
  }
  const entries: DiffFileEntry[] = splitNul(out).map((path) => ({
    path,
    status,
    score: 0,
    kind: OBJECT_KIND_BLOB,
    mode: '',
    binary: false
  }));

  // Not for the ignored listing: those rows are `--directory`, so they are folders as
  // often as files, and there can be thousands of them for a build output nobody reads.
  if (!options.ignored)
  {
    await measureAll(repoPath, entries);
  }
  return entries;
}

/** The changed paths for a range, sorted, with untracked files folded in. */
export async function listDiffFiles(
  repoPath: string,
  range: DiffRange,
  options: DiffOptions = {}
): Promise<DiffFileEntry[]>
{
  const out = await runGit(repoPath, buildDiffArgs(range, DIFF_MODE_NAMES, options), {
    kind: GIT_KIND_READ
  });
  const entries = parseDiffRaw(out);

  if (touchesWorkingTree(range))
  {
    const known = new Set(entries.map((entry) => entry.path));
    const extra: DiffFileEntry[] = [];
    // Include untracked unless disabled; ignored only on request (can be thousands of rows).
    if (options.includeUntracked !== false)
    {
      extra.push(...(await listUntracked(repoPath)));
    }
    if (options.includeIgnored)
    {
      extra.push(...(await listUntracked(repoPath, { ignored: true })));
    }
    for (const entry of extra)
    {
      if (!known.has(entry.path))
      {
        known.add(entry.path);
        entries.push(entry);
      }
    }
  }

  return entries.sort(compareDiffFiles);
}

/**
 * The patch for one file.
 * Uses full file object since untracked files need a different command, and renames need both paths for detection.
 */
export async function readDiffPatch(
  repoPath: string,
  range: DiffRange,
  file: DiffFileEntry,
  options: DiffOptions = {}
): Promise<DiffPatch>
{
  let paths;
  if (file.origPath)
  {
    paths = [file.origPath, file.path];
  }
  else
  {
    paths = [file.path];
  }

  let text;
  if (file.status === FILE_STATUS_UNTRACKED)
  {
    text = await runGit(repoPath, buildUntrackedPatchArgs(file.path, options), {
      kind: GIT_KIND_READ,
      // `--no-index` exits 1 on differences; that is normal and produces the patch.
      allowFailure: true
    });
  }
  else
  {
    text = await runGit(repoPath, buildDiffArgs(range, DIFF_MODE_PATCH, { ...options, paths }), {
      kind: GIT_KIND_READ
    });
  }

  const truncated = text.length > MAX_GIT_OUTPUT_BYTES;
  let shown: string;
  if (truncated)
  {
    shown = text.slice(0, MAX_GIT_OUTPUT_BYTES);
  }
  else
  {
    shown = text;
  }
  return {
    path: file.path,
    text: shown,
    truncated
  };
}
