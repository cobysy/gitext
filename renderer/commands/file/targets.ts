/**
 * "Do I have everything this command needs?", asked once per shape instead of once per
 * command. Each of these takes the loose pieces a menu row can reach (a repository that
 * may be absent, a path that may not be selected, a range that may not exist yet) and
 * returns either a whole operand or null, so the caller has one `if` rather than four.
 *
 * Pure, importing no store: what the pieces *are* is `context.ts`'s question, and these
 * only decide whether they add up.
 */

import type { DiffEndpoint, DiffRange } from '@shared/diff.js';
import type { RepoInfo } from '@shared/types.js';
import type { FilePath } from '@renderer/model/paths.js';
import type { PatchFile } from '@renderer/model/patch.js';
import type { StagingSide } from '@renderer/stores/staging.js';

export interface FileRangeTarget {
  repo: RepoInfo;
  path: string;
  range: DiffRange;
}

/** The repo/path/range a single-file, single-range command needs, or null when any is missing. */
export function fileRangeTargetOf(
  repo: RepoInfo | null,
  path: string | undefined,
  range: DiffRange | null
): FileRangeTarget | null
{
  if (repo && path && range)
  {
    return { repo, path, range };
  }
  else
  {
    return null;
  }
}

export interface PathEndpointTarget {
  repo: RepoInfo;
  path: string;
  endpoint: DiffEndpoint;
}

/** The repo/path/endpoint to run a working-tree comparison against, or null when any is missing. */
export function pathEndpointTargetOf(
  repo: RepoInfo | null,
  path: string | undefined,
  endpoint: DiffEndpoint | null
): PathEndpointTarget | null
{
  if (repo && path && endpoint)
  {
    return { repo, path, endpoint };
  }
  else
  {
    return null;
  }
}

export interface TwoPathsTarget {
  repo: RepoInfo;
  endpoint: DiffEndpoint;
  paths: readonly [string, string];
}

/** The repo/endpoint/pair to compare two files at, or null unless exactly two are selected. */
export function twoPathsTargetOf(
  repo: RepoInfo | null,
  endpoint: DiffEndpoint | undefined,
  paths: readonly string[]
): TwoPathsTarget | null
{
  if (repo && endpoint && paths.length === 2)
  {
    return { repo, endpoint, paths: [paths[0]!, paths[1]!] };
  }
  else
  {
    return null;
  }
}

export interface ChunkTarget {
  repo: RepoInfo;
  file: PatchFile;
  target: { path: FilePath; side: StagingSide };
}

/** The repo/file/hunk-target to reset a chunk from, or null when the commit screen isn't set up for it. */
export function chunkTargetOf(
  repo: RepoInfo | null,
  onCommitScreen: boolean,
  file: PatchFile | null,
  target: { path: FilePath; side: StagingSide } | null
): ChunkTarget | null
{
  if (repo && onCommitScreen && file && target)
  {
    return { repo, file, target };
  }
  else
  {
    return null;
  }
}
