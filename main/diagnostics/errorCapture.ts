/**
 * What happens when an error is recorded: the log says where it is, and takes down
 * enough of the repository to reproduce the fault without it.
 *
 * A log is read on another machine, by someone who does not have the repository and
 * never will. So at the error it gains the two things that make up for that: the state
 * the repository was in (an operation half done, a conflicted file), and what git had
 * last told the app, which is the repository as far as the app ever knew it.
 *
 * Once per burst: an uncaught error arrives as thrown and again as shown, and a failure
 * that repeats would otherwise write the same pointer and the same snapshot over and over.
 */

import { DIAGNOSTIC_NOTE, DIAGNOSTIC_OUTPUT } from '@shared/types/diagnostics.js';
import { getRepoState } from '@main/git/repo.js';
import { getCommandLog, tryGit } from '@main/git/runner.js';
import { currentRepository, onErrorRecorded, record } from './index.js';
import { recentOutputs } from './flightRecorder.js';
import { sessionLogPath } from './sessionLog.js';
import { writeToSystemLog } from './systemLog.js';

/** How long after one capture another error goes without its own. */
const QUIET_MS = 1000;

/**
 * The status read a snapshot takes: the branch, its upstream and every changed path, in
 * the form the app's own parser reads, so a rebuilt repository can be checked against it.
 */
const STATUS_ARGV = ['status', '--porcelain=v2', '--branch', '-z'];

let lastCapturedAt = 0;

/** The newest record an earlier dump already wrote out. */
let dumpedThrough = 0;

/**
 * Say on the main process's console, and in the system log Console shows, where this
 * run's log is: nobody should have to remember the logs directory to find it.
 */
function pointToSessionLog(): void
{
  const path = sessionLogPath();
  if (!path)
  {
    return;
  }
  const pointer = `Diagnostics log: ${path}`;
  console.error(pointer);
  writeToSystemLog(pointer);
}

/** The operation in progress and its conflicts, and a status read for the dump to carry. */
async function snapshot(repoPath: string): Promise<void>
{
  const [state] = await Promise.all([
    getRepoState(repoPath).catch(() => null),
    tryGit(repoPath, STATUS_ARGV)
  ]);
  if (!state)
  {
    record(DIAGNOSTIC_NOTE, 'repository at the error: unreadable', { detail: [repoPath] });
    return;
  }
  record(DIAGNOSTIC_NOTE, 'repository at the error', {
    detail: [
      `operation ${state.operation}`,
      `conflicts ${state.conflictCount}`,
      ...state.conflictedPaths.map((path) => `conflicted ${path}`)
    ]
  });
}

/** Write what git last said, for every command not already written by an earlier error. */
function dumpRecentOutput(): void
{
  for (const output of recentOutputs(getCommandLog(), dumpedThrough))
  {
    record(DIAGNOSTIC_OUTPUT, output.text, { detail: output.detail });
    dumpedThrough = Math.max(dumpedThrough, output.id);
  }
}

async function capture(): Promise<void>
{
  const now = Date.now();
  if (now - lastCapturedAt < QUIET_MS)
  {
    return;
  }
  lastCapturedAt = now;
  pointToSessionLog();
  const repoPath = currentRepository();
  if (repoPath)
  {
    await snapshot(repoPath);
  }
  dumpRecentOutput();
}

/** Called once at startup, after the session log is open. */
export function installErrorCapture(): void
{
  onErrorRecorded(() =>
  {
    void capture().catch(() =>
    {
      /* A capture that fails leaves the error itself recorded, which is the point. */
    });
  });
}
