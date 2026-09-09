/**
 * Reading one file's contents at one end of a comparison. Only one of the three
 * endpoints is a git object: a commit's copy is `git show <sha>:<path>`, the staged
 * copy is `git show :<path>` (git's own spelling for the index), and the working copy
 * is a plain file read, since there's no git command for "the bytes currently in the
 * working tree". Bytes, not text: a blob may be an image, and decoding as UTF-8 on the way through would corrupt it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ENDPOINT_KIND_COMMIT, ENDPOINT_KIND_INDEX, type DiffEndpoint } from '@shared/diff.js';
import { ENCODING_UTF8, GIT_KIND_READ, runGitBuffer } from './runner.js';

const CMD_SHOW = 'show';

/** The revision `git show` wants for an endpoint, or null for the working tree. */
function revisionOf(endpoint: DiffEndpoint): string | null
{
  if (endpoint.kind === ENDPOINT_KIND_COMMIT)
  {
    return endpoint.sha;
  }
  if (endpoint.kind === ENDPOINT_KIND_INDEX)
  {
    return '';
  }
  return null;
}

/**
 * Resolve a repo-relative path inside the repository, refusing anything that climbs
 * out: a function that reads a file from an argument is worth making impossible to
 * point at `../../.ssh/id_rsa`. Exported for `conflicts.ts`, which needs the same guard.
 * Containment is decided by `relative`, not a string-prefix test: `/w/proj` is a prefix
 * of `/w/projSecret`, so a naive check would let `../projSecret/id_rsa` through. A
 * symlink pointing out of the working tree is deliberately not covered: git itself follows it, and resolving it here would disagree with every `git show` beside it.
 */
export function resolveInRepo(repoPath: string, path: string): string
{
  const root = resolve(repoPath);
  const full = resolve(join(root, path));
  const inside = relative(root, full);
  // `..` exactly, or a leading `../`: never a file whose name merely starts with dots.
  const climbs = inside === '..' || inside.startsWith(`..${sep}`);
  if (isAbsolute(path) || inside === '' || climbs || isAbsolute(inside))
  {
    throw new Error(`Path is outside the repository: ${path}`);
  }
  return full;
}

/**
 * A working-tree file as text, for the editor window. Separate from `readFileAt` below,
 * which answers in bytes: this is only asked about a file about to be edited as text.
 * Absent reads as empty, same as `readRepoText`: a shown file may already be deleted on disk.
 */
export async function readWorkingText(repoPath: string, path: string): Promise<string>
{
  try
  {
    return await readFile(resolveInRepo(repoPath, path), ENCODING_UTF8);
  }
  catch
  {
    return '';
  }
}

/** Write one back. No `mkdir`: this edits a file the list is showing, so its directory exists, and creating one would turn a typo'd path into a new tree instead of an error. */
export async function writeWorkingText(
  repoPath: string,
  path: string,
  text: string
): Promise<void>
{
  await writeFile(resolveInRepo(repoPath, path), text, ENCODING_UTF8);
}

/** One file's contents at `endpoint`. */
export async function readFileAt(
  repoPath: string,
  endpoint: DiffEndpoint,
  path: string
): Promise<Buffer>
{
  const revision = revisionOf(endpoint);
  if (revision === null)
  {
    return readFile(resolveInRepo(repoPath, path));
  }
  // `<rev>:<path>` for a commit, `:<path>` for the index, one syntax, resolved relative to the repository root exactly as the diff named it.
  return runGitBuffer(repoPath, [CMD_SHOW, `${revision}:${path}`], { kind: GIT_KIND_READ });
}
