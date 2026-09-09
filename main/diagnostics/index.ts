/**
 * The diagnostics timeline: one ordered record of what happened this session, for the
 * bug report that says "it broke and I don't know what I did".
 *
 * It holds four things the command log alone cannot: **what the user asked for** (a
 * command id, which is the only thing git can never tell you), **what git ran**,
 * **what threw**, and **what the app was running on**. Ordered together, because which
 * command ran before the error is usually the whole question.
 *
 * Git runs arrive by subscribing to `runnerEvents` rather than by the runner calling in:
 * the runner's job is spawning, and nothing in it should have to know this exists.
 *
 * In memory, not appended to disk. A rolling file would put I/O on the path of every git
 * command to buy nothing most sessions; what a crash actually needs is `writeCrashReport`
 * below, which flushes the ring at the one moment the ring is about to be lost.
 */

import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DIAGNOSTIC_COMMAND,
  DIAGNOSTIC_ERROR,
  DIAGNOSTIC_GIT,
  DIAGNOSTIC_NOTE,
  DIAGNOSTIC_SESSION,
  DIAGNOSTICS_RING_DEPTH,
  type DiagnosticEntry,
  type DiagnosticKind
} from '@shared/types/diagnostics.js';
import type { GitCommandRecord, Settings } from '@shared/types.js';
import { runnerEvents } from '@main/git/runner.js';
import { renderReport, renderReportLines } from './report.js';
import { fileResolver, resolveStack } from './sourcemap.js';

/**
 * Settings that say where a window was, not how the app behaves.
 *
 * Every one of these differs from the default on any machine that has been used, so
 * listing them buries the handful of settings that actually explain a report: one
 * `dialogBounds` is six lines of window geometry on its own.
 */
const NOT_BEHAVIOUR = new Set<keyof Settings>([
  'dialogBounds',
  'recentRepos',
  'gridColumns',
  'leftPanelSections',
  'leftPanelWidth',
  'commitListsWidth',
  'commitMessageHeight',
  'commitStagedHeight'
]);

/** How much of a failing command's output the timeline keeps. Enough to read the error. */
const MAX_OUTPUT_LINES = 12;

const ring: DiagnosticEntry[] = [];

/** The repository the last `noteRepository` named, so a report can be repo-relative. */
let currentRepoRoot: string | null = null;

export function record(
  kind: DiagnosticKind,
  text: string,
  extra: Partial<Pick<DiagnosticEntry, 'detail' | 'durationMs' | 'exitCode'>> = {}
): void
{
  // Here rather than in `noteError`, so no path can miss it: a window reports its errors
  // straight down `diagnostics:record`, which never went through `noteError` and so
  // filed a dozen unresolved bundle offsets every time.
  //
  // A main-process stack arrives already resolved by `setSourceMapsEnabled`, and its
  // frames name `.ts` files with no `.map` beside them, so this leaves them alone.
  let entry: DiagnosticEntry = { at: Date.now(), kind, text, ...extra };
  if (kind === DIAGNOSTIC_ERROR && entry.detail)
  {
    entry = { ...entry, detail: resolveStack(entry.detail, fileResolver) };
  }
  ring.push(entry);
  if (ring.length > DIAGNOSTICS_RING_DEPTH)
  {
    ring.splice(0, ring.length - DIAGNOSTICS_RING_DEPTH);
  }
}

export function getDiagnostics(): DiagnosticEntry[]
{
  return [...ring];
}

/** For tests, and for a session that has been reported and wants a clean timeline. */
export function clearDiagnostics(): void
{
  ring.length = 0;
}

/**
 * What a failing command said, capped.
 *
 * Only failures: a successful `git log` returns megabytes that explain nothing, while a
 * failure's first few lines are usually the entire bug report.
 */
function outputOf(record: GitCommandRecord): string[] | undefined
{
  if (record.exitCode === 0 && !record.spawnError)
  {
    return undefined;
  }
  const said = [record.stderr, record.stdout].filter(Boolean).join('\n').trim();
  if (record.spawnError)
  {
    return [record.spawnError, ...said.split('\n').slice(0, MAX_OUTPUT_LINES)].filter(Boolean);
  }
  if (!said)
  {
    return undefined;
  }
  return said.split('\n').slice(0, MAX_OUTPUT_LINES);
}

/**
 * Record the app's own identity, once, at startup. First entry in every report, and the
 * one that stops a triage conversation starting with three questions about versions.
 */
export function noteSession(gitVersion: string): void
{
  record(DIAGNOSTIC_SESSION, `gitext ${app.getVersion()}`, {
    detail: [
      `electron ${process.versions.electron} · chrome ${process.versions.chrome} · node ${process.versions.node}`,
      `${process.platform} ${process.getSystemVersion?.() ?? ''} ${process.arch}`.trim(),
      gitVersion
    ]
  });
}

/**
 * The settings this session is running under, at startup and after every change.
 *
 * The environment says what the app is; this says how it was told to behave, and without
 * it half a report cannot be reproduced. A `stash push` that saved nothing was caused by
 * `checkoutLocalChanges: stash` meeting an untracked directory, and neither the argv nor
 * the exit code says so.
 *
 * Only what differs from the defaults. All of it would be seventy lines of noise at the
 * top of every report, and the defaults are in the source anyway: what a reader needs is
 * the short list of things this user changed.
 */
export function noteSettings(settings: Settings, defaults: Settings): void
{
  const changed: string[] = [];
  for (const key of (Object.keys(settings) as (keyof Settings)[]).sort())
  {
    if (NOT_BEHAVIOUR.has(key))
    {
      continue;
    }
    if (JSON.stringify(settings[key]) === JSON.stringify(defaults[key]))
    {
      continue;
    }
    changed.push(`${key} = ${JSON.stringify(settings[key])}`);
  }

  if (changed.length === 0)
  {
    record(DIAGNOSTIC_NOTE, 'settings: all default');
    return;
  }
  record(DIAGNOSTIC_NOTE, `settings: ${changed.length} changed from default`, {
    detail: changed
  });
}

/** A repository was opened: its shape, which is what makes a report reproducible. */
export function noteRepository(repoPath: string, shape: readonly string[]): void
{
  currentRepoRoot = repoPath;
  record(DIAGNOSTIC_NOTE, `repository ${repoPath}`, { detail: [...shape] });
}

/** Something the user asked for, by command id: the half of a report git cannot supply. */
export function noteCommand(id: string, detail?: readonly string[]): void
{
  if (detail && detail.length > 0)
  {
    record(DIAGNOSTIC_COMMAND, id, { detail: [...detail] });
  }
  else
  {
    record(DIAGNOSTIC_COMMAND, id);
  }
}

/**
 * A dialog window opened, was raised again, or closed.
 *
 * Without this a report goes quiet at exactly the wrong moment: `cmd branch.checkout` is
 * followed by nothing at all, because what it did was open a window, and a reader is left
 * unable to tell a dialog that never appeared from one the user thought better of. Most
 * of this app is dialogs, so most of what a report has to explain happens in one.
 */
export function noteDialog(what: 'opened' | 'raised' | 'closed', name: string): void
{
  record(DIAGNOSTIC_NOTE, `dialog ${what}: ${name}`);
}

/** A thrown error from either process. `where` says which, since the report cannot tell. */
export function noteError(where: string, message: string, stack?: string): void
{
  let detail: string[] | undefined;
  if (stack)
  {
    detail = stack.split('\n').map((line) => line.trim());
  }
  record(DIAGNOSTIC_ERROR, `${where}: ${message}`, { detail });
}

/**
 * Subscribe to the runner. Called once at startup; a record arrives twice, on start and
 * on exit, and only the finished one is a fact worth keeping.
 */
export function watchGitCommands(): void
{
  runnerEvents.on('record', (entry: GitCommandRecord) =>
  {
    if (entry.running)
    {
      return;
    }
    const said = outputOf(entry);
    const extra: Parameters<typeof record>[2] = {
      durationMs: entry.durationMs,
      exitCode: entry.exitCode
    };
    if (said)
    {
      extra.detail = said;
    }
    record(DIAGNOSTIC_GIT, entry.argv.join(' '), extra);
  });
}

/**
 * A setting changed while the session was running.
 *
 * Recorded as well as the snapshot at startup, because a report whose interesting moment
 * is "and then I turned that off" reads as nothing happening at all otherwise. The
 * Settings dialog writes straight through `settings:patch`, so a command entry does not
 * cover it.
 */
export function noteSettingsChange(patch: Partial<Settings>): void
{
  const changed = Object.entries(patch).map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
  if (changed.length === 0)
  {
    return;
  }
  record(DIAGNOSTIC_NOTE, 'settings changed', { detail: changed });
}

/**
 * The report, redacted or not. `redact` comes from the setting, default off.
 *
 * `jsonl` is the same timeline as one object per line, for a reader that wants to count
 * and group rather than scan. Chosen by the extension the user saves under, so there is
 * one question at the save dialog rather than two.
 */
export function buildReport(redact: boolean, jsonl = false): string
{
  const options = {
    redact,
    redaction: { home: homedir(), repoRoot: currentRepoRoot },
    generatedAt: Date.now()
  };
  if (jsonl)
  {
    return renderReportLines(getDiagnostics(), options);
  }
  return renderReport(getDiagnostics(), options);
}

/**
 * Write the timeline out because the app is going down.
 *
 * The one case an in-memory ring cannot serve on its own, and the one that matters most:
 * a crash is exactly when nobody is left to press "Save Diagnostics…". Synchronous on
 * purpose, since the process may not survive the next tick.
 */
export function writeCrashReport(redact: boolean): string | null
{
  try
  {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(app.getPath('logs'), `gitext-crash-${stamp}.txt`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buildReport(redact), 'utf8');
    return file;
  }
  catch
  {
    // A crash handler that throws replaces one unreadable failure with another.
    return null;
  }
}
