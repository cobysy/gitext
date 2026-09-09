/**
 * Hunk- and line-level staging operations.
 *
 * These work by generating a patch and piping it to `git apply --cached`, which is what
 * keeps the operation in the command log.
 */

import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IgnoreTarget } from '@shared/types.js';
import { repoTextFilePath } from './repoText.js';
import { ENCODING_UTF8, GIT_KIND_READ, runGit } from './runner.js';

/** Apply a patch text to the index (stage a hunk). */
export async function applyPatchToIndex(repoPath: string, patch: string): Promise<void>
{
  await runGit(repoPath, [CMD_APPLY, FLAG_CACHED, FLAG_WHITESPACE], { stdin: patch });
}

/** Reverse-apply a patch from the index (unstage a hunk). */
export async function reverseApplyFromIndex(repoPath: string, patch: string): Promise<void>
{
  await runGit(repoPath, [CMD_APPLY, FLAG_CACHED, FLAG_REVERSE, FLAG_WHITESPACE], {
    stdin: patch
  });
}

/**
 * Where the two ignore files are: asked of `repoText.ts`, which owns the table.
 * `IgnoreTarget` is a subset of `RepoTextFile`. A joined `.git/info/exclude` path
 * breaks in a linked worktree, where `.git` is a file and the shared dir is elsewhere.
 */
const ignorePath = repoTextFilePath;

/**
 * What one of the two ignore files currently holds, or `''` when it doesn't exist yet:
 * a repository need have neither, so a missing file is empty contents, not an error.
 */
export async function readIgnoreRules(
  repoPath: string,
  target: IgnoreTarget
): Promise<string>
{
  try
  {
    return await readFile(await ignorePath(repoPath, target), ENCODING_UTF8);
  }
  catch
  {
    return '';
  }
}

/**
 * Append rules to one of them. A newline is written first only when the file has
 * content that doesn't end in one, or appending would extend the last line into a rule nobody wrote.
 */
export async function addIgnoreRules(
  repoPath: string,
  target: IgnoreTarget,
  patterns: string[]
): Promise<void>
{
  const kept = patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
  if (kept.length === 0)
  {
    return;
  }

  const path = await ignorePath(repoPath, target);
  // `git init` makes `.git/info`, but a repository cloned with a trimmed `.git` may not
  // have the directory at all.
  await mkdir(dirname(path), { recursive: true });

  const existing = await readIgnoreRules(repoPath, target);
  let lead;
  if (existing.length > 0 && !existing.endsWith(NEWLINE))
  {
    lead = NEWLINE;
  }
  else
  {
    lead = '';
  }
  await appendFile(path, `${lead}${kept.join(NEWLINE)}${NEWLINE}`, ENCODING_UTF8);
}

/** The two `update-index` flags that make git pretend a tracked file has not changed. */
export type IndexFlag = 'skip-worktree' | 'assume-unchanged';

/** Tag for skip-worktree flag in `ls-files -v` output. */
const INDEX_TAG_SKIP_WORKTREE = 'S';

// Git commands
const CMD_APPLY = 'apply';
const CMD_UPDATE_INDEX = 'update-index';
const CMD_LS_FILES = 'ls-files';
const CMD_RM = 'rm';

// Git flags and options
const FLAG_CACHED = '--cached';
const FLAG_REVERSE = '--reverse';
const FLAG_WHITESPACE = '--whitespace=nowarn';
const FLAG_FORCE = '-f';
const FLAG_VERBOSE = '-v';
const PATH_SEPARATOR = '--';

// File encoding and separators
const NEWLINE = '\n';

const NEGATION_PREFIX = 'no-';

/**
 * Set or clear one of the index flags on a path. `--skip-worktree` says "never take an
 * update to this"; `--assume-unchanged` is a performance promise git may still clobber. They look identical in any listing, hence two toggles.
 */
export async function setIndexFlag(
  repoPath: string,
  paths: string[],
  flag: IndexFlag,
  on: boolean
): Promise<void>
{
  if (paths.length === 0)
  {
    return;
  }
  let negation: string;
  if (on)
  {
    negation = '';
  }
  else
  {
    negation = NEGATION_PREFIX;
  }
  await runGit(repoPath, [CMD_UPDATE_INDEX, `--${negation}${flag}`, PATH_SEPARATOR, ...paths]);
}

/**
 * Which paths carry which index flag. `ls-files -v` prefixes each path with a
 * one-letter tag; lowercase means marked (`h` for assume-unchanged, `S` for
 * skip-worktree). No porcelain and no `-z` variant exists for this, so it's parsed by
 * line, safe since the tag and space come first and a refname can't appear here.
 */
export async function listIndexFlags(
  repoPath: string
): Promise<{ skipWorktree: string[]; assumeUnchanged: string[] }>
{
  const out = await runGit(repoPath, [CMD_LS_FILES, FLAG_VERBOSE], { kind: GIT_KIND_READ });
  const skipWorktree: string[] = [];
  const assumeUnchanged: string[] = [];

  for (const line of out.split(NEWLINE))
  {
    if (line.length < 3)
    {
      continue;
    }
    const tag = line[0]!;
    const path = line.slice(2);
    if (tag === INDEX_TAG_SKIP_WORKTREE)
    {
      skipWorktree.push(path);
    }
    // Every lowercase tag means assume-unchanged; `h` is the ordinary cached one.
    else if (tag >= 'a' && tag <= 'z')
    {
      assumeUnchanged.push(path);
    }
  }

  return { skipWorktree, assumeUnchanged };
}

/**
 * Take a path out of the index while leaving it on disk.
 *
 * `--cached` is the whole point: without it `git rm` deletes the file, and "stop
 * tracking this" never means "and delete my work".
 */
export async function stopTracking(repoPath: string, paths: string[]): Promise<void>
{
  if (paths.length === 0)
  {
    return;
  }
  await runGit(repoPath, [CMD_RM, FLAG_CACHED, PATH_SEPARATOR, ...paths]);
}

/**
 * Delete files from the working tree and the index. `-f`, since the point is deleting
 * something with changes in it, which git otherwise refuses. Untracked files aren't in the index, so they're unlinked instead.
 */
export async function deleteFiles(
  repoPath: string,
  tracked: string[],
  untracked: string[]
): Promise<void>
{
  if (tracked.length > 0)
  {
    await runGit(repoPath, [CMD_RM, FLAG_FORCE, PATH_SEPARATOR, ...tracked]);
  }
  for (const path of untracked)
  {
    await rm(join(repoPath, path), { force: true });
  }
}

/**
 * Apply a patch to the working tree, not the index: what "reset chunk of file" is,
 * reverse-applying one hunk on disk. No `--cached`, the whole difference from the two functions above.
 */
export async function applyPatchToWorkingTree(
  repoPath: string,
  patch: string,
  reverse: boolean
): Promise<void>
{
  const args = [CMD_APPLY];
  if (reverse)
  {
    args.push(FLAG_REVERSE);
  }
  args.push(FLAG_WHITESPACE);
  await runGit(repoPath, args, { stdin: patch });
}
