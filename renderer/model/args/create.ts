/**
 * `git clone` and `git init` argv: the two commands that make a repository rather than
 * acting on one.
 *
 * Both are run with a working directory of their own rather than the window's open
 * repository, so the destination is always given as an argument and never left to the cwd.
 * That keeps the argv the preview shows identical to the one that runs, which is the point
 * of building it here at all.
 */

const CMD_CLONE = 'clone';
const CMD_INIT = 'init';
const FLAG_DEPTH = '--depth';
const FLAG_BRANCH = '--branch';
const FLAG_RECURSE_SUBMODULES = '--recurse-submodules';
const FLAG_BARE = '--bare';
const FLAG_INITIAL_BRANCH = '--initial-branch';

export interface CloneOptions {
  /** What to clone. Any transport git understands: this code does not parse it. */
  url: string;
  /** Where it lands: the new directory, not the folder it goes in. */
  destination: string;
  /**
   * Truncate history to this many commits. Zero or absent clones all of it; git rejects a
   * `--depth` of 0, so it is left off rather than passed through.
   */
  depth?: number;
  /** Check out this branch instead of the remote's default. */
  branch?: string;
  recurseSubmodules?: boolean;
  bare?: boolean;
}

export function buildCloneArgs(options: CloneOptions): string[]
{
  const argv = [CMD_CLONE];

  if (options.depth && options.depth > 0)
  {
    argv.push(FLAG_DEPTH, String(options.depth));
  }
  if (options.branch)
  {
    argv.push(FLAG_BRANCH, options.branch);
  }
  if (options.recurseSubmodules)
  {
    argv.push(FLAG_RECURSE_SUBMODULES);
  }
  if (options.bare)
  {
    argv.push(FLAG_BARE);
  }

  // Last, and always both: `--` is not accepted here, so a URL that looks like a flag is
  // git's problem, but the destination must never be inferred from the cwd.
  argv.push(options.url, options.destination);
  return argv;
}

export interface InitOptions {
  /** The directory to make a repository. Created if it is not there yet. */
  directory: string;
  /**
   * What to call the first branch. Git's own default comes from `init.defaultBranch`, so
   * an empty value here means "whatever this machine is configured for", not `master`.
   */
  initialBranch?: string;
  bare?: boolean;
}

export function buildInitArgs(options: InitOptions): string[]
{
  const argv = [CMD_INIT];

  if (options.initialBranch)
  {
    argv.push(`${FLAG_INITIAL_BRANCH}=${options.initialBranch}`);
  }
  if (options.bare)
  {
    argv.push(FLAG_BARE);
  }

  argv.push(options.directory);
  return argv;
}
