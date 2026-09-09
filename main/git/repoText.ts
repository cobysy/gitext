/**
 * The four repository files the app lets you edit as text. `.gitignore` and
 * `.gitattributes` sit in the working tree; `info/exclude` and `config` sit in the git
 * directory shared by every worktree, hence `resolveCommonGitDir` for those two. The
 * renderer names a *target*, never a path: a channel that took one would let any renderer read and write anywhere on disk.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RepoTextFile } from '@shared/types.js';
import { resolveCommonGitDir } from './repo.js';
import { ENCODING_UTF8, GIT_KIND_READ, runGit } from './runner.js';

// File encoding

// RepoTextFile target naming the config file
const TARGET_CONFIG = 'config';

// Git command, flags and kind
const CMD_CONFIG = 'config';
const FLAG_FILE = '-f';
const FLAG_LIST = '--list';

/** Where each file lives: under the working tree, or under the shared git directory. A table, not a `switch`, so a fifth file is a line here and nothing else. */
const LOCATIONS: Record<RepoTextFile, { inGitDir: boolean; parts: readonly string[] }> = {
  gitignore: { inGitDir: false, parts: ['.gitignore'] },
  gitattributes: { inGitDir: false, parts: ['.gitattributes'] },
  exclude: { inGitDir: true, parts: ['info', 'exclude'] },
  config: { inGitDir: true, parts: ['config'] }
};

/** Where one of them is on disk. Exported because the ignore *rule* writer in `stage.ts` needs the same answer, and a second copy of this table would resolve `.git/info/exclude` the naive way. */
export async function repoTextFilePath(
  repoPath: string,
  target: RepoTextFile
): Promise<string>
{
  const location = LOCATIONS[target];
  let base;
  if (location.inGitDir)
  {
    base = await resolveCommonGitDir(repoPath);
  }
  else
  {
    base = repoPath;
  }
  return join(base, ...location.parts);
}

/** What the file holds, or `''` when not there. A repository need have none of the first three, so absent is ordinary: the editor opens empty and saving creates the file. */
export async function readRepoText(repoPath: string, target: RepoTextFile): Promise<string>
{
  try
  {
    return await readFile(await repoTextFilePath(repoPath, target), ENCODING_UTF8);
  }
  catch
  {
    return '';
  }
}

/**
 * Whether git can parse this as a config file, and what it says if not. `config` is the
 * one target where a bad save breaks the repository: git refuses to run *at all*
 * against a config it can't parse. Asked of git, not checked here, since the grammar is
 * git's. The other three have no syntax to be wrong about.
 */
export async function checkRepoText(
  repoPath: string,
  target: RepoTextFile,
  text: string
): Promise<string | null>
{
  if (target !== TARGET_CONFIG)
  {
    return null;
  }

  const probe = join(tmpdir(), `gitext-config-check-${process.pid}-${Date.now()}`);
  await writeFile(probe, text, ENCODING_UTF8);
  try
  {
    await runGit(repoPath, [CMD_CONFIG, FLAG_FILE, probe, FLAG_LIST], { kind: GIT_KIND_READ });
    return null;
  }
  catch (err)
  {
    // git names the line, the useful half, which is why this reports as text rather than
    // a boolean. It also names the temp copy it read, a path the reader can't see, so that half is rewritten to the file they're actually editing.
    let message;
    if (err instanceof Error)
    {
      message = err.message;
    }
    else
    {
      message = '';
    }
    if (!message)
    {
      return 'Git could not parse this config file.';
    }
    return message.split(probe).join(await repoTextFilePath(repoPath, target));
  }
  finally
  {
    await rm(probe, { force: true });
  }
}

/**
 * Write the file, creating it and its directory if not there. `.git/info` in particular
 * can be missing: `git init` makes it, but a trimmed clone may not have it. Validation
 * is the caller's: the dialog runs `checkRepoText` first so it can refuse with git's own message still on screen.
 */
export async function writeRepoText(
  repoPath: string,
  target: RepoTextFile,
  text: string
): Promise<void>
{
  const path = await repoTextFilePath(repoPath, target);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, ENCODING_UTF8);
}
