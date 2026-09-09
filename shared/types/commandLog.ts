/**
 * The command log and the git-environment health check.
 *
 * Everything here must be structured-clone-safe: it crosses the IPC boundary.
 */

/** How a git subprocess was classified when it ran. Drives filtering in the command log. */
export type GitCommandKind = 'read' | 'write';

/** The two `GitCommandKind` values, for callers passing an explicit `{ kind }`. */
export const GIT_KIND_READ: GitCommandKind = 'read';
export const GIT_KIND_WRITE: GitCommandKind = 'write';

/**
 * One git subprocess invocation, start to finish. Produced by `runner.ts` for every
 * spawn, streamed to the renderer's command log: the record behind the transparency guarantee that what is displayed is what actually ran.
 */
export interface GitCommandRecord {
  id: number;
  /** Argv *after* the global `-c` flags, i.e. what the user conceptually asked for. */
  argv: string[];
  /** Full argv including injected config flags: what was really handed to git. */
  fullArgv: string[];
  cwd: string;
  kind: GitCommandKind;
  startedAt: number;
  durationMs: number;
  /** Null while still running. */
  exitCode: number | null;
  /** What the command printed, up to `MAX_RECORD_OUTPUT` characters. Capped because a record is kept (the ring holds hundreds) and broadcast to every open window. */
  stdout: string;
  stderr: string;
  /** Characters `stdout` would have held uncapped, set only when it was cut short. */
  stdoutBytes?: number;
  /** The same for `stderr`. */
  stderrBytes?: number;
  /** True until the process exits; the record is re-sent on completion. */
  running: boolean;
  /** Set when the process could not be spawned at all (e.g. git not found). */
  spawnError?: string;
  /**
   * The caller expected this to be able to fail, and a non-zero exit is an answer rather
   * than a fault.
   *
   * `git config --get merge.tool` exits 1 when the key is simply unset, which is the
   * ordinary case; without this the health check painted a red "2 failed" badge on the
   * status bar of a perfectly healthy repository. The run is still logged in full: it is
   * counted differently, not hidden.
   */
  optional?: boolean;
}

/** How much of a command's output a record keeps: generous for anything a person reads, far under the size at which holding it costs anything. */
export const MAX_RECORD_OUTPUT = 64 * 1024;

/**
 * One instalment of a streaming git run: `event:streamLine`'s payload. Coalesced like
 * `LogBatch`: one message per line would cost more in IPC than the command does in
 * work. Both of git's streams are in `lines`, interleaved as they arrived: `git gc`
 * writes progress to stderr, so a caller reading stdout alone would see nothing.
 */
export interface GitStreamBatch {
  /** Identifies which run this belongs to; a superseded run's batches are dropped. */
  requestId: number;
  lines: string[];
  /** True on the final batch, whether the command succeeded or failed. */
  done: boolean;
  /** Set on the final batch. Null when the process was cancelled or never spawned. */
  exitCode?: number | null;
  /** Set when the run failed outright; `lines` is then whatever arrived first. */
  error?: string;
  /**
   * The line git is still writing, as it stands now: a progress meter spends a whole
   * phase rewriting one line with no newline in it, so a window that waited for the
   * newline would show nothing until the phase was over. Replaces whatever partial line
   * was shown before, and arrives in `lines` once it finally ends.
   */
  partial?: string;
}

/**
 * Everything a window that arrived late needs to draw a run it did not see start: see
 * `stream:state`. The same facts as the batches it missed, folded together.
 */
export interface StreamState {
  lines: string[];
  done: boolean;
  exitCode?: number | null;
  error?: string;
  /** The line still being written when this was read: see `GitStreamBatch.partial`. */
  partial?: string;
}

/** Serialized form of a failed git invocation, rethrown in the renderer. */
export interface GitErrorPayload {
  message: string;
  argv: string[];
  /** The repository the command ran in. */
  cwd: string;
  exitCode: number | null;
  stderr: string;
}

export interface GitVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
}

/** Result of resolving the git binary at startup. */
export interface GitEnvironment {
  path: string;
  version: GitVersion | null;
  /** Present when git could not be found or run. */
  error?: string;
}

/** One item from the first-run health check. */
export interface HealthCheckItem {
  id: 'git' | 'gitVersion' | 'userName' | 'userEmail' | 'mergetool' | 'home';
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
  /** Command id that fixes it, if there is one. */
  fixCommand?: string;
}
