/**
 * Reading and writing one conflicted file for the in-app conflict editor. A merge
 * conflict is a file with up to three git objects behind it: the common ancestor (stage
 * 1), this branch's copy (stage 2), the other branch's copy (stage 3), plus whatever
 * git already wrote to the working tree. `git show :N:path` reads each stage; the
 * working copy is a plain file read, the same distinction `readFileAt` draws for diff endpoints.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConflictBlobs, ConflictSideRef, ConflictSides, InProgressOperation } from '@shared/types.js';
import { getRepoState, resolveGitDir } from './repo.js';
import { ENCODING_UTF8, GIT_KIND_READ, GitError, runGit, tryGit } from './runner.js';
import { resolveInRepo } from './file.js';

const CMD_SHOW = 'show';
const CMD_REV_PARSE = 'rev-parse';
const CMD_NAME_REV = 'name-rev';
const FLAG_NAME_ONLY = '--name-only';
const FLAG_EXCLUDE_TAGS = '--exclude=tags/*';
const REF_HEAD = 'HEAD';
const SHORT_SHA_LENGTH = 7;
const OP_AM = 'am';

const STAGE_BASE = 1;
const STAGE_OURS = 2;
const STAGE_THEIRS = 3;

/**
 * "This stage of this path is not there", in git's wording for `show :N:path`. An
 * add/add conflict has no stage 1; a delete/modify conflict has no stage 2 or 3 on
 * whichever side deleted it, both ordinary shapes of a conflict, not failures.
 */
const STAGE_ABSENT_STDERR = /^fatal: [Pp]ath .*(does not exist|is in the index, but not)/;

/** One stage of one path, or null when this conflict does not have that stage. */
async function readStage(repoPath: string, stage: number, path: string): Promise<string | null>
{
  try
  {
    return await runGit(repoPath, [CMD_SHOW, `:${stage}:${path}`], { kind: GIT_KIND_READ });
  }
  catch (err)
  {
    if (err instanceof GitError && STAGE_ABSENT_STDERR.test(err.stderr.trim()))
    {
      return null;
    }
    throw err;
  }
}

/** Every side of one conflicted file, for the conflict editor to open on. */
export async function readConflictBlobs(repoPath: string, path: string): Promise<ConflictBlobs>
{
  const [base, ours, theirs, working] = await Promise.all([
    readStage(repoPath, STAGE_BASE, path),
    readStage(repoPath, STAGE_OURS, path),
    readStage(repoPath, STAGE_THEIRS, path),
    readFile(resolveInRepo(repoPath, path), ENCODING_UTF8)
  ]);
  return { base, ours, theirs, working };
}

/** Write the editor's result back to the working tree. Staging it (`git add`) is a separate step through `git:run`, so the command log shows each as what it is. */
export async function writeConflictResolution(
  repoPath: string,
  path: string,
  text: string
): Promise<void>
{
  await writeFile(resolveInRepo(repoPath, path), text, ENCODING_UTF8);
}

/**
 * Which marker ref names "theirs" for an operation that can leave a conflict: the
 * commit git is trying to bring in, as opposed to HEAD. Unset for `am`: a patch being applied is an mbox entry, not a commit yet, so there's no ref for it to resolve.
 */
const THEIRS_REF: Partial<Record<InProgressOperation, string>> = {
  merge: 'MERGE_HEAD',
  'cherry-pick': 'CHERRY_PICK_HEAD',
  revert: 'REVERT_HEAD',
  // Set since git 2.24. A rebase's sequencer checks the upstream out as HEAD before replaying each commit, which is why HEAD below is "ours" here too.
  rebase: 'REBASE_HEAD'
};

/** `ref`, resolved to a real commit and a name worth showing: a branch when one points here, the short SHA otherwise. Null when `ref` doesn't resolve at all. */
async function resolveRef(repoPath: string, ref: string): Promise<ConflictSideRef | null>
{
  const sha = (await tryGit(repoPath, [CMD_REV_PARSE, ref]))?.trim();
  if (!sha)
  {
    return null;
  }
  const name = (
    await tryGit(repoPath, [CMD_NAME_REV, FLAG_NAME_ONLY, FLAG_EXCLUDE_TAGS, sha])
  )?.trim();
  return { sha, name: name || sha.slice(0, SHORT_SHA_LENGTH) };
}

/**
 * Which real commit "ours" and "theirs" are, for whatever operation is in progress: so
 * the conflict editor shows a name and history behind each side, not just stage numbers.
 */
/** One `KEY='value'` line of git's `author-script`, which is shell rather than config. */
function shellVar(text: string, key: string): string
{
  const match = new RegExp(`^${key}='(.*)'$`, 'm').exec(text);
  if (!match)
  {
    return '';
  }
  // git escapes an embedded quote as `'\''`: closing, escaped, reopening
  return match[1]!.split("'\\''").join("'");
}

/**
 * The incoming side of a `git am`, which is a patch, not a commit. No ref to resolve,
 * so identity comes from what the sequencer wrote when it stopped:
 * `rebase-apply/author-script` and `rebase-apply/final-commit`.
 */
async function resolveApplyingPatch(repoPath: string): Promise<ConflictSideRef | null>
{
  const dir = join(await resolveGitDir(repoPath), 'rebase-apply');

  const read = async (name: string): Promise<string> =>
  {
    try
    {
      return await readFile(join(dir, name), ENCODING_UTF8);
    }
    catch
    {
      return '';
    }
  };

  const [script, message, next, last] = await Promise.all([
    read('author-script'),
    read('final-commit'),
    read('next'),
    read('last')
  ]);

  const subject = message.split('\n')[0]?.trim() ?? '';
  const author = shellVar(script, 'GIT_AUTHOR_NAME');
  const date = Date.parse(shellVar(script, 'GIT_AUTHOR_DATE'));

  // "Patch 2 of 5" when there is no subject to show: an mbox with an empty message is odd but legal, and a nameless side is worse than a positional one.
  let name = subject;
  if (!name)
  {
    const at = next.trim();
    const total = last.trim();
    if (at && total)
    {
      name = `Patch ${at} of ${total}`;
    }
    else
    {
      name = 'The patch being applied';
    }
  }

  const side: ConflictSideRef = { sha: null, name };
  if (author)
  {
    side.author = author;
  }
  if (Number.isFinite(date))
  {
    side.authorTime = Math.floor(date / 1000);
  }
  return side;
}

export async function resolveConflictSides(repoPath: string): Promise<ConflictSides>
{
  const { operation } = await getRepoState(repoPath);
  const theirsRef = THEIRS_REF[operation];
  let theirsPromise: Promise<ConflictSideRef | null>;
  if (theirsRef)
  {
    theirsPromise = resolveRef(repoPath, theirsRef);
  }
  else if (operation === OP_AM)
  {
    theirsPromise = resolveApplyingPatch(repoPath);
  }
  else
  {
    theirsPromise = Promise.resolve(null);
  }
  const [ours, theirs] = await Promise.all([resolveRef(repoPath, REF_HEAD), theirsPromise]);
  return { ours, theirs };
}
