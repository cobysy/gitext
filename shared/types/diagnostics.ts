/**
 * What the diagnostics log holds: one timeline of everything that happened, so a bug
 * report can say what the user did as well as what git did.
 *
 * The command log answers "what did git run"; on its own that is only ever the
 * consequences. An entry here is any of the four things a report needs to reconstruct a
 * session, in the order they happened.
 */

export const DIAGNOSTIC_SESSION = 'session';
export const DIAGNOSTIC_COMMAND = 'command';
export const DIAGNOSTIC_GIT = 'git';
export const DIAGNOSTIC_ERROR = 'error';
export const DIAGNOSTIC_NOTE = 'note';
export const DIAGNOSTIC_TIMING = 'timing';

export type DiagnosticKind =
  /** The app started: what it is, what it is running on, what git it found. */
  | typeof DIAGNOSTIC_SESSION
  /** Something the user asked for, by command id. The one thing git can never tell you. */
  | typeof DIAGNOSTIC_COMMAND
  /** A git subprocess that finished, with its argv, exit code and duration. */
  | typeof DIAGNOSTIC_GIT
  /** A thrown error, from either process, with whatever stack there was. */
  | typeof DIAGNOSTIC_ERROR
  /** A fact worth having in the timeline: a repository opened, and its shape. */
  | typeof DIAGNOSTIC_NOTE
  /**
   * How long a piece of the app's *own* work took: laying the graph out, reading the
   * log. Git times itself and a `git` entry carries that; nothing else did, so a report
   * could say the app felt slow and show only fast git commands.
   */
  | typeof DIAGNOSTIC_TIMING;

export interface DiagnosticEntry {
  /** Unix milliseconds: the timeline is read across two processes, so wall clock it is. */
  at: number;
  kind: DiagnosticKind;
  /** One line, already human-readable. What a reader scans. */
  text: string;
  /**
   * The lines under it: a stack, a repository's counts, an argv's output. Kept apart
   * from `text` so the renderer can indent them and a reader can skim past them.
   */
  detail?: string[];
  /** Milliseconds the thing took, where that means something. */
  durationMs?: number;
  /** A git run's exit code, `null` while it is still the only thing we know. */
  exitCode?: number | null;
}

/**
 * How many entries the ring holds. Deeper than the command log's 500, because this
 * timeline carries that log *and* everything around it, and a report is worth nothing if
 * it starts after the thing that went wrong.
 */
export const DIAGNOSTICS_RING_DEPTH = 2000;

/**
 * Above this, an entry is marked `SLOW` in the report.
 *
 * Not a judgement about what is acceptable: a number to grep for, so a reader with two
 * thousand lines can find the handful worth looking at without reading them all. Set
 * where a person starts to feel a pause rather than where a profiler would complain.
 */
export const SLOW_MS = 250;
