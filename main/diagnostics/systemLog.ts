/**
 * A line in the system log, which is what Console shows.
 *
 * An app opened from Finder has no console of its own: what the main process prints goes
 * nowhere anyone can read. The system log is the one place that run has a voice, so a
 * line that has to be findable afterwards goes there as well.
 *
 * Through `logger` rather than a native binding: one subprocess per line, for lines that
 * arrive once per error, is cheaper than a native module in a small dependency set.
 * `logger` drops its tag on the way into the unified log, so the line carries the app's
 * name itself, which is what a search in Console matches.
 */

import { spawn } from 'node:child_process';
import { isMac } from '@main/platform.js';

const LOGGER_BIN = '/usr/bin/logger';

/** Write `message` to the system log, prefixed with the app's name. Never throws. */
export function writeToSystemLog(message: string): void
{
  if (!isMac())
  {
    return;
  }
  try
  {
    const child = spawn(LOGGER_BIN, [`gitext: ${message}`], { stdio: 'ignore' });
    // A line that cannot be logged is lost; the error it points to is still on disk.
    child.on('error', () => undefined);
    child.unref();
  }
  catch
  {
    /* Same, for a spawn that throws rather than failing asynchronously. */
  }
}
