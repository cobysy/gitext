/**
 * What the repository still holds but nothing points at: `git fsck`. A commit orphaned
 * by a `reset --hard`, an amend, or a deleted branch stays in the object database,
 * entire and readable, until gc removes it. Two passes: fsck alone prints `dangling
 * commit <sha>` and nothing else, so the commits are described in a second read.
 */

import { GIT_KIND_READ, runGit } from './runner.js';
import { parseFsck, splitNul } from './parse.js';
import { buildFsckArgs, type FsckOptions } from '@shared/fsck.js';
import { parseParents } from '@shared/parents.js';
import { OBJECT_KIND_COMMIT, type LostObject } from '@shared/types.js';

/** How many SHAs go into one `git log` invocation: 500 SHAs is about 20 KB, comfortably inside argv's platform limits. */
const METADATA_BATCH = 500;

/**
 * The fields a lost commit is described by, NUL-separated: `%s` is a commit subject and
 * can contain anything a person typed. No terminator of its own: `git log -z` supplies
 * it as the record separator, since `--pretty=format:` puts a newline between records
 * and a format ending in `%x00` would otherwise land that newline at the front of the next record's SHA.
 */
const DESCRIBE_FORMAT = '%H%x00%an%x00%ct%x00%s%x00%P';

/** How many fields `DESCRIBE_FORMAT` produces per commit. */
const FIELDS_PER_COMMIT = 5;

const CMD_LOG = 'log';
const FLAG_NUL_TERMINATED = '-z';
const FLAG_NO_WALK = '--no-walk';
const FLAG_IGNORE_MISSING = '--ignore-missing';

/**
 * Describe as many of these commits as git can, keyed by SHA. `--no-walk`: these are
 * individual commits, not a history, so without it git would walk each one's ancestry.
 * `--ignore-missing`: a `missing` object is exactly what fsck may have just reported, and one bad SHA must not fail the rest.
 */
async function describeCommits(
  repoPath: string,
  shas: readonly string[]
): Promise<Map<string, Omit<LostObject, 'state' | 'kind' | 'sha'>>>
{
  const described = new Map<string, Omit<LostObject, 'state' | 'kind' | 'sha'>>();

  for (let at = 0; at < shas.length; at += METADATA_BATCH)
  {
    const batch = shas.slice(at, at + METADATA_BATCH);
    const output = await runGit(
      repoPath,
      [
        CMD_LOG,
        FLAG_NUL_TERMINATED,
        FLAG_NO_WALK,
        FLAG_IGNORE_MISSING,
        `--pretty=format:${DESCRIBE_FORMAT}`,
        ...batch
      ],
      { kind: GIT_KIND_READ, allowFailure: true }
    ).catch(() => '');

    const fields = splitNul(output);
    for (let i = 0; i + FIELDS_PER_COMMIT <= fields.length; i += FIELDS_PER_COMMIT)
    {
      const [sha, author, date, subject, parents] = fields.slice(i, i + FIELDS_PER_COMMIT) as [
        string,
        string,
        string,
        string,
        string
      ];
      described.set(sha, {
        author,
        date: Number(date) || undefined,
        subject,
        parents: parseParents(parents)
      });
    }
  }

  return described;
}

/**
 * Every object fsck reports, described where git can describe it. A non-zero exit is
 * caught rather than allowed to throw: fsck exits non-zero only on actual *errors* (a
 * corrupt object), not on finding dangling ones, so the failure is worth reporting but
 * not before the objects it did manage to list.
 */
export async function runFsck(
  repoPath: string,
  options: FsckOptions = {}
): Promise<LostObject[]>
{
  // Never `--lost-found` here: this is the listing read, and that flag makes it write files. The dialog's Save button runs that variant through `stream:start` instead.
  const argv = buildFsckArgs({ ...options, lostFound: false });

  let output = '';
  try
  {
    output = await runGit(repoPath, argv, { kind: GIT_KIND_READ });
  }
  catch (error)
  {
    // `GitError` carries git's stdout nowhere, so a damaged repository's partial report is lost with the throw; re-running with `allowFailure` gets both back.
    output = await runGit(repoPath, argv, { kind: GIT_KIND_READ, allowFailure: true }).catch(
      () =>
      {
        throw error;
      }
    );
  }

  const refs = parseFsck(output);
  const commitShas = refs.filter((ref) => ref.kind === OBJECT_KIND_COMMIT).map((ref) => ref.sha);
  const described = await describeCommits(repoPath, commitShas);

  return refs.map((ref) => ({ ...ref, ...described.get(ref.sha) }));
}
