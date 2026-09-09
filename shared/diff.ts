/**
 * What a diff is *between*, and the argv that asks git for it. One pivot `{ from, to }`
 * covers commit/index/working-tree in every combination; `buildDiffArgs` is the sole source of argv.
 */

import { INDEX_SHA, WORKING_TREE_SHA, artificialKind } from './artificial.js';
import { OBJECT_KIND_BLOB, OBJECT_KIND_SUBMODULE, type FileStatusCode } from './types.js';

// Endpoint kinds
export const ENDPOINT_KIND_COMMIT = 'commit';
export const ENDPOINT_KIND_INDEX = 'index';
export const ENDPOINT_KIND_WORKING_TREE = 'workingTree';

// Whitespace modes
const WHITESPACE_CHANGE = 'change';
const WHITESPACE_ALL = 'all';

// Diff modes
const DIFF_MODE_NAMES = 'names';
const DIFF_MODE_PATCH = 'patch';
const DIFF_MODE_TOOL = 'tool';

// Git commands
const CMD_DIFF = 'diff';
const CMD_DIFF_TREE = 'diff-tree';
const CMD_DIFFTOOL = 'difftool';

// Git flags
const FLAG_CACHED = '--cached';
const FLAG_REVERSE = '-R';
const FLAG_ROOT = '--root';
const FLAG_RECURSIVE = '-r';
const FLAG_NO_COMMIT_ID = '--no-commit-id';
const FLAG_NO_INDEX = '--no-index';
const FLAG_NO_PROMPT = '--no-prompt';
const FLAG_NO_EXT_DIFF = '--no-ext-diff';
export const PATH_SEPARATOR = '--';
export const DEV_NULL = '/dev/null';

/**
 * One side of a comparison. The two artificial rows are endpoints, not revisions:
 * their sentinel SHAs must never reach git, so they're named by what they are and turn into `--cached` or no revision at all.
 */
export type DiffEndpoint =
  | { kind: 'commit'; sha: string }
  | { kind: 'index' }
  | { kind: 'workingTree' };

export interface DiffRange {
  /**
   * The older side, or null for "whatever came before, as git works it out": a root
   * commit or the index of an unborn branch, both diffed against the empty tree with no revision named.
   */
  from: DiffEndpoint | null;
  /** The newer side. What the file list is showing the state *of*. */
  to: DiffEndpoint;
}

/**
 * What to ask git for: changed paths, the patch, or neither. `tool` exists here too
 * because `difftool` takes the same revision arguments, keeping the eight-case endpoint table in one place.
 */
export type DiffMode = 'names' | 'patch' | 'tool';

export interface DiffOptions {
  /**
   * `-b` collapses runs of whitespace, `-w` ignores it entirely. Asymmetric in git: it
   * suppresses the patch but not `--name-status`, so a whitespace-only change stays listed with an empty diff.
   */
  ignoreWhitespace?: 'none' | 'change' | 'all';
  /** Unified context lines. git's own default is 3. */
  contextLines?: number;
  /** Limit the diff to these paths. */
  paths?: string[];
  /**
   * Fold untracked files into a working-tree listing. Defaults to true: they're in no
   * tree and no index, so nothing diffs them, but a commit screen that omitted a new file would be wrong.
   */
  includeUntracked?: boolean;
  /** Also list ignored files, which nothing reports unless asked. */
  includeIgnored?: boolean;
}

export const DEFAULT_CONTEXT_LINES = 3;

/**
 * The context count that means "the whole file": git has no flag for it, so this is
 * `--unified` with a number no file reaches, keeping the viewer drawing a patch git actually printed.
 */
export const WHOLE_FILE_CONTEXT = 1_000_000;

/** Whether two endpoints name the same thing: a diff of which would be empty. */
export function sameEndpoint(a: DiffEndpoint | null, b: DiffEndpoint | null): boolean
{
  if (a === null || b === null)
  {
    return a === b;
  }
  if (a.kind !== b.kind)
  {
    return false;
  }
  return a.kind !== ENDPOINT_KIND_COMMIT || a.sha === (b as { sha: string }).sha;
}

function whitespaceFlags(options: DiffOptions): string[]
{
  switch (options.ignoreWhitespace)
  {
    case WHITESPACE_CHANGE:
      return ['--ignore-space-change'];
    case WHITESPACE_ALL:
      return ['--ignore-all-space'];
    default:
      return [];
  }
}

function modeFlags(mode: DiffMode, options: DiffOptions): string[]
{
  // Nothing at all: difftool produces no output for anyone to parse.
  if (mode === DIFF_MODE_TOOL)
  {
    return [];
  }
  if (mode === DIFF_MODE_NAMES)
  {
    // `--raw` (not `--name-status`) says whether a row is a submodule or symlink; a
    // status letter alone can't. `--numstat` flags binary files with `-` for both counts.
    return ['--raw', '--numstat', '-z', '--find-renames'];
  }
  return [
    '--patch',
    `--unified=${options.contextLines ?? DEFAULT_CONTEXT_LINES}`,
    // A configured difftool must not replace the patch about to be parsed.
    FLAG_NO_EXT_DIFF,
    '--find-renames'
  ];
}

/**
 * The argv for a diff: the same array the command log records and, in patch mode, one
 * a user could paste into a terminal. `git diff` reads "old new", so a reversed pair runs the same command with `-R`:
 *
 * | from        | to          | argv                        |
 * |-------------|-------------|-----------------------------|
 * | null        | commit      | `diff-tree --root -r <sha>` |
 * | null        | index       | `diff --cached`             |
 * | commit A    | commit B    | `diff A B`                  |
 * | commit A    | index       | `diff --cached A`           |
 * | commit A    | workingTree | `diff A`                    |
 * | index       | workingTree | `diff`                      |
 * | index       | commit B    | `diff --cached -R B`        |
 * | workingTree | commit B    | `diff -R B`                 |
 * | workingTree | index       | `diff -R`                   |
 *
 * Throws when both sides name the same thing: no git command exists for that, and
 * every caller here derives the range from a selection that can check first.
 */
export function buildDiffArgs(
  range: DiffRange,
  mode: DiffMode,
  options: DiffOptions = {}
): string[]
{
  const { from, to } = range;
  if (sameEndpoint(from, to))
  {
    throw new Error('A diff range needs two different endpoints');
  }

  const flags = [...modeFlags(mode, options)];
  if (mode === DIFF_MODE_PATCH)
  {
    flags.push(...whitespaceFlags(options));
  }
  let paths: string[];
  if (options.paths?.length)
  {
    paths = [PATH_SEPARATOR, ...options.paths];
  }
  else
  {
    paths = [];
  }

  if (from === null)
  {
    // A root commit: `--root` makes diff-tree emit the commit's own contents rather
    // than nothing; `--no-commit-id` drops the header line the parsers would otherwise skip.
    if (to.kind === ENDPOINT_KIND_COMMIT)
    {
      return [CMD_DIFF_TREE, FLAG_ROOT, FLAG_RECURSIVE, FLAG_NO_COMMIT_ID, ...flags, to.sha, ...paths];
    }
    // The index of an unborn branch: an unborn HEAD resolves to the empty tree rather
    // than failing, so everything staged reads as added, which is what it is.
    if (to.kind === ENDPOINT_KIND_INDEX)
    {
      return [CMD_DIFF, FLAG_CACHED, ...flags, ...paths];
    }
    throw new Error('The working tree has no diff against nothing');
  }

  if (from.kind === ENDPOINT_KIND_COMMIT && to.kind === ENDPOINT_KIND_COMMIT)
  {
    return [CMD_DIFF, ...flags, from.sha, to.sha, ...paths];
  }
  if (from.kind === ENDPOINT_KIND_COMMIT)
  {
    // Both remaining `to` kinds compare that commit against something uncommitted;
    // `--cached` picks index vs. working tree.
    let cached: string[];
    if (to.kind === ENDPOINT_KIND_INDEX)
    {
      cached = [FLAG_CACHED];
    }
    else
    {
      cached = [];
    }
    return [CMD_DIFF, ...cached, ...flags, from.sha, ...paths];
  }

  // `from` is artificial from here down, so the comparison runs backwards through git's
  // own ordering and `-R` puts it right, rather than silently swapping the endpoints.
  const reverse = [FLAG_REVERSE];

  if (to.kind === ENDPOINT_KIND_COMMIT)
  {
    let cached: string[];
    if (from.kind === ENDPOINT_KIND_INDEX)
    {
      cached = [FLAG_CACHED];
    }
    else
    {
      cached = [];
    }
    return [CMD_DIFF, ...cached, ...reverse, ...flags, to.sha, ...paths];
  }

  // index → workingTree is the unstaged diff (`git diff`, no revision); workingTree →
  // index is that reversed.
  let backwards: string[];
  if (from.kind === ENDPOINT_KIND_WORKING_TREE)
  {
    backwards = reverse;
  }
  else
  {
    backwards = [];
  }
  return [CMD_DIFF, ...backwards, ...flags, ...paths];
}

/**
 * `git difftool` over the same two ends the pane is showing, for one path. Built from
 * `buildDiffArgs` so the external tool can never see a different comparison than what's on screen.
 */
export function buildDifftoolArgs(range: DiffRange, path: string): string[]
{
  const [subcommand, ...rest] = buildDiffArgs(range, DIFF_MODE_TOOL, { paths: [path] });
  // A root commit is the one case answered with `diff-tree`, which has no difftool
  // equivalent; its parent is the empty tree, the same comparison difftool accepts.
  let args;
  if (subcommand === CMD_DIFF_TREE)
  {
    args = rest.filter((arg) => arg !== FLAG_ROOT && arg !== FLAG_RECURSIVE && arg !== FLAG_NO_COMMIT_ID);
  }
  else
  {
    args = rest;
  }
  return [CMD_DIFFTOOL, FLAG_NO_PROMPT, ...args];
}

/**
 * The argv that shows an untracked file as one long addition. `--no-index` puts git in
 * "compare two paths" mode, with `/dev/null` as git's own spelling of "this file is new". Exits 1, so run with `allowFailure`.
 */
export function buildUntrackedPatchArgs(path: string, options: DiffOptions = {}): string[]
{
  return [
    CMD_DIFF,
    FLAG_NO_INDEX,
    `--unified=${options.contextLines ?? DEFAULT_CONTEXT_LINES}`,
    FLAG_NO_EXT_DIFF,
    ...whitespaceFlags(options),
    PATH_SEPARATOR,
    DEV_NULL,
    path
  ];
}

/** How many lines a change added and removed, as `--numstat` counted them. */
export interface LineCounts {
  added: number;
  deleted: number;
}

/** One changed path, as `--raw --numstat` reports it. */
export interface DiffFileEntry {
  path: string;
  /** Where a renamed or copied file came from. */
  origPath?: string;
  status: FileStatusCode;
  /** Similarity percentage git scored a rename or copy at; 0 for everything else. */
  score: number;
  /**
   * What the row *is*, not what happened to it: same distinction `TreeEntry` draws.
   * Learned from the mode, not the status, since `M` is `M` either way.
   */
  kind: typeof OBJECT_KIND_BLOB | typeof OBJECT_KIND_SUBMODULE;
  /** The six-digit mode at the newer end (or older, for a deleted file); empty if untracked. */
  mode: string;
  /** git had no text diff to print: `--numstat` reported `-` for both counts. */
  binary: boolean;
  /**
   * What the change did, in lines. Absent where git counted nothing rather than counting
   * zero: a binary file, and an untracked file, which no diff mentions at all.
   */
  lines?: LineCounts;
}

/** One file's patch, as git printed it. */
export interface DiffPatch {
  path: string;
  /** The unified diff verbatim. Parsed in the renderer by `renderer/model/patch.ts`. */
  text: string;
  /** The patch was cut short at the size cap; what is here is the start of it. */
  truncated: boolean;
}

/** Sort key for a file list: by directory, then by name, the way a tree would read. */
export function compareDiffFiles(a: DiffFileEntry, b: DiffFileEntry): number
{
  return a.path.localeCompare(b.path);
}

/** The endpoint a selected grid row is, whichever of the three kinds of row it is. */
function endpointOf(sha: string): DiffEndpoint
{
  const kind = artificialKind(sha);
  if (kind === ENDPOINT_KIND_WORKING_TREE)
  {
    return { kind: ENDPOINT_KIND_WORKING_TREE };
  }
  if (kind === ENDPOINT_KIND_INDEX)
  {
    return { kind: ENDPOINT_KIND_INDEX };
  }
  return { kind: ENDPOINT_KIND_COMMIT, sha };
}

/**
 * The grid row an endpoint *is*, as a SHA: the inverse of `endpointOf`. The sentinel
 * SHAs let selection use one code path; `isArtificialSha` guards this from ever reaching git.
 */
export function rowShaOf(endpoint: DiffEndpoint): string
{
  if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
  {
    return WORKING_TREE_SHA;
  }
  if (endpoint.kind === ENDPOINT_KIND_INDEX)
  {
    return INDEX_SHA;
  }
  return endpoint.sha;
}

/**
 * The pivot the grid's selection implies. `picks` is click order: two or more compares
 * first-clicked to last; one row compares to what precedes it by kind (parent, HEAD, or the index).
 */
export function rangeForSelection(
  picks: readonly string[],
  firstParentOf: (sha: string) => string | null | undefined
): DiffRange | null
{
  if (picks.length === 0)
  {
    return null;
  }

  if (picks.length > 1)
  {
    const from = endpointOf(picks[0]!);
    const to = endpointOf(picks[picks.length - 1]!);
    if (!sameEndpoint(from, to))
    {
      return { from, to };
    }
  }

  const sha = picks[picks.length - 1]!;
  const kind = artificialKind(sha);
  if (kind === ENDPOINT_KIND_WORKING_TREE)
  {
    return { from: { kind: ENDPOINT_KIND_INDEX }, to: { kind: ENDPOINT_KIND_WORKING_TREE } };
  }
  if (kind === ENDPOINT_KIND_INDEX)
  {
    return { from: null, to: { kind: ENDPOINT_KIND_INDEX } };
  }

  const parent = firstParentOf(sha);
  let from: DiffEndpoint | null;
  if (parent)
  {
    from = { kind: ENDPOINT_KIND_COMMIT, sha: parent };
  }
  else
  {
    from = null;
  }
  return {
    from,
    to: { kind: ENDPOINT_KIND_COMMIT, sha }
  };
}

/** A short description of what a range compares, for the file list's header. */
export function describeRange(range: DiffRange, shorten: (sha: string) => string): string
{
  const name = (endpoint: DiffEndpoint | null): string =>
  {
    if (endpoint === null)
    {
      return 'the empty tree';
    }
    if (endpoint.kind === ENDPOINT_KIND_INDEX)
    {
      return 'the index';
    }
    if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
    {
      return 'the working directory';
    }
    return shorten(endpoint.sha);
  };
  return `${name(range.from)} → ${name(range.to)}`;
}
