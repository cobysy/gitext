/**
 * What `git blame --porcelain` says about a file: who wrote each line, and when.
 *
 * Everything here must be structured-clone-safe: it crosses the IPC boundary.
 */

/**
 * Commit metadata from git blame, printed once per commit (not per line).
 * See parser for cache strategy.
 */
export interface BlameCommitInfo {
  sha: string;
  author: string;
  authorMail: string;
  /** Unix seconds. */
  authorTime: number;
  /** Raw git offset string, e.g. +0200, not applied. */
  authorTz: string;
  committer: string;
  committerMail: string;
  committerTime: number;
  committerTz: string;
  summary: string;
  /** File path in commit (can differ if -M/-C used, which this app doesn't; kept for porcelain compatibility). */
  filename: string;
  /** Set when commit renamed the file (came from different path in first parent). */
  previousSha?: string;
  previousPath?: string;
  /** Commit where file/repo began: no further parent to blame. */
  boundary?: boolean;
}

/** One line of a blamed file, in final-file order. */
export interface BlameLine {
  /** Commit introducing this line. All-zero means uncommitted edit (git's sentinel). */
  sha: string;
  origLine: number;
  finalLine: number;
  text: string;
}

/** A whole file, blamed: every line, and the commits behind them. */
export interface BlameFile {
  path: string;
  lines: BlameLine[];
  /** Keyed by sha: plain object survives structured clone unlike Map. */
  commits: Record<string, BlameCommitInfo>;
  /**
   * The file is not text, so there is nothing to attribute a line at a time: `lines` and
   * `commits` are empty. git blames a PNG as happily as a source file and answers with
   * its bytes cut at every newline that happens to be in them, which is neither readable
   * nor a line of anything.
   */
  binary: boolean;
}
