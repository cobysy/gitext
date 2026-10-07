/**
 * The diagnostics timeline, written to disk as it happens.
 *
 * The ring in `index.ts` answers "Save Diagnostics…", and is flushed on its own when
 * something goes uncaught. Neither covers an error the app *handled*: a dialog's error
 * line or a toast is gone in seconds, the session ends, and the ring goes with it. This
 * file is what is left to read afterwards: every entry the ring took, one file per run.
 *
 * Appended through a stream, so the write itself is off the main thread: what a git
 * command pays for being logged is formatting one line.
 *
 * Bounded twice: a run past `SESSION_LOG_MAX_BYTES` continues in a fresh file, and the
 * directory keeps the newest `SESSION_LOGS_KEPT`. The names sort by time because the
 * stamp is ISO, which is what lets `staleSessionLogs` be a sort and a slice.
 */

import { createWriteStream, mkdirSync, readdirSync, rmSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

const SESSION_LOG_PREFIX = 'gitext-session-';
const SESSION_LOG_SUFFIX = '.log';

/** How many session logs the directory holds, the current one included. */
export const SESSION_LOGS_KEPT = 20;

/** Past this, the run continues in a new file: a day of background polling stays readable. */
export const SESSION_LOG_MAX_BYTES = 10 * 1024 * 1024;

interface OpenLog {
  stream: WriteStream;
  path: string;
  bytes: number;
}

interface SessionLogState {
  directory: string;
  header: () => string[];
  current: OpenLog | null;
}

const state: SessionLogState = { directory: '', header: () => [], current: null };

function isSessionLog(name: string): boolean
{
  return name.startsWith(SESSION_LOG_PREFIX) && name.endsWith(SESSION_LOG_SUFFIX);
}

/** The session logs among `names` that make room for `keep` newer ones, oldest first. */
export function staleSessionLogs(names: readonly string[], keep: number): string[]
{
  const logs = names.filter(isSessionLog).sort();
  return logs.slice(0, Math.max(0, logs.length - keep));
}

function fileStamp(): string
{
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function prune(): void
{
  // One fewer than kept, since the file about to be opened is one of them.
  for (const name of staleSessionLogs(readdirSync(state.directory), SESSION_LOGS_KEPT - 1))
  {
    rmSync(join(state.directory, name), { force: true });
  }
}

function write(text: string): void
{
  if (!state.current)
  {
    return;
  }
  state.current.stream.write(text);
  state.current.bytes += Buffer.byteLength(text);
}

function startFile(): string | null
{
  try
  {
    mkdirSync(state.directory, { recursive: true });
    prune();
    const path = join(state.directory, `${SESSION_LOG_PREFIX}${fileStamp()}${SESSION_LOG_SUFFIX}`);
    const stream = createWriteStream(path, { flags: 'a' });
    // A log that cannot be written stops; it does not take the app down with it.
    stream.on('error', () =>
    {
      state.current = null;
    });
    state.current = { stream, path, bytes: 0 };
    write(`${state.header().join('\n')}\n\n`);
    return path;
  }
  catch
  {
    state.current = null;
    return null;
  }
}

/**
 * Start this run's log in `directory`, headed by `header`, and answer where it is.
 * Null when it could not be opened, in which case every append is a no-op.
 */
export function openSessionLog(directory: string, header: () => string[]): string | null
{
  state.directory = directory;
  state.header = header;
  return startFile();
}

/** The file entries are going to now, or null when none could be opened. */
export function sessionLogPath(): string | null
{
  return state.current?.path ?? null;
}

/** Append one entry's lines, moving to a fresh file once this one is full. */
export function appendToSessionLog(lines: readonly string[]): void
{
  write(`${lines.join('\n')}\n`);
  if (state.current && state.current.bytes >= SESSION_LOG_MAX_BYTES)
  {
    state.current.stream.end();
    startFile();
  }
}
