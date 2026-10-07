/**
 * The renderer's half of the diagnostics timeline: what the user asked for, and what
 * this window threw. Main records git and its own errors; these two are the ones only a
 * window can see.
 *
 * Fire-and-forget by design. A window that stalled because it was busy filing a
 * diagnostic would be a fine bug to have to diagnose, so nothing here is awaited and
 * every failure is swallowed: a report is worth having, never worth blocking for.
 */

import {
  DIAGNOSTIC_COMMAND,
  DIAGNOSTIC_ERROR,
  DIAGNOSTIC_NOTE,
  DIAGNOSTIC_SHOWN,
  DIAGNOSTIC_TIMING,
  type DiagnosticKind
} from '@shared/types/diagnostics.js';
import { watch } from 'vue';
import { api } from '@renderer/api.js';
import { observeCommands } from '@renderer/commands/registry.js';

/**
 * Which window a line came from, since the timeline merges every window and the main
 * process into one. Named `window …` rather than bare, because "main" is both this
 * window and the other process, and a report that cannot tell them apart is a report
 * that sends someone looking in the wrong half of the app.
 */
function windowName(): string
{
  // Guarded, because the stores that record timings are unit-tested under Node with no
  // DOM at all: a diagnostic that throws in a test suite is worse than no diagnostic.
  if (typeof window === 'undefined')
  {
    return 'window (none)';
  }
  return `window ${new URLSearchParams(window.location.search).get('dialog') ?? 'main'}`;
}

function send(kind: DiagnosticKind, text: string, detail?: string[], durationMs?: number): void
{
  try
  {
    void api['diagnostics:record'](kind, text, detail, durationMs).catch(() =>
    {
      /* A window that cannot file a diagnostic has a bigger problem than the diagnostic. */
    });
  }
  catch
  {
    /* Same, for a throw on the way in rather than on the way back. */
  }
}

/**
 * How long a piece of the app's own work took.
 *
 * Git times itself and every `git` entry carries that, so a report could show nothing but
 * fast commands while the window sat still: laying out a 17.7k-row graph is work that
 * nothing else recorded. What this cannot see is a cost paid per frame rather than per
 * operation, which still wants a profiler: `formatAbsoluteDate` was 44us called forty
 * times a render, and no mark would have shown it.
 */
export function noteTiming(label: string, durationMs: number, detail?: string[]): void
{
  send(DIAGNOSTIC_TIMING, `${label}  (${windowName()})`, detail, Math.round(durationMs));
}

/** Time `work`, record it, and hand back whatever it returned. */
export function measure<T>(label: string, work: () => T, detail?: () => string[]): T
{
  const started = performance.now();
  try
  {
    return work();
  }
  finally
  {
    noteTiming(label, performance.now() - started, detail?.());
  }
}

/** A stack as the report wants it: one entry per frame, indent already stripped. */
function linesOf(stack: string | undefined): string[] | undefined
{
  if (!stack)
  {
    return undefined;
  }
  return stack.split('\n').map((line) => line.trim());
}

/**
 * An error the app caught and put in front of the user: a toast, a dialog's error line.
 * Nothing threw, so nothing else records it, and it is the one line the user remembers.
 */
export function noteShownError(message: string): void
{
  send(DIAGNOSTIC_SHOWN, `${message}  (${windowName()})`);
}

/** Past this, a value written into the timeline is cut: a line, not a dump. */
const MAX_VALUE_CHARS = 600;

/** `value` as one line of JSON, cut to length, or why it could not be written. */
function asLine(value: unknown): string
{
  let text: string;
  try
  {
    text = JSON.stringify(value) ?? String(value);
  }
  catch
  {
    text = '(not serialisable)';
  }
  if (text.length <= MAX_VALUE_CHARS)
  {
    return text;
  }
  return `${text.slice(0, MAX_VALUE_CHARS)}... (${text.length} chars)`;
}

/**
 * What this window has selected, as lines: set by the window that knows its stores
 * (`useSelectionTrail`). Empty in a window that never said.
 */
let describeSelection: () => string[] = () => [];

/**
 * A command the user ran, by id, with what it was handed and what was selected.
 * Handed to `runCommand`, the one funnel they all pass. The id says which operation; most
 * commands take their operand from the selection, so without it a reader knows a branch
 * was checked out and not which.
 */
function noteCommandRun(id: string, options: unknown): void
{
  const detail: string[] = [];
  if (options !== undefined)
  {
    detail.push(`options ${asLine(options)}`);
  }
  detail.push(...describeSelection());
  send(DIAGNOSTIC_COMMAND, `${id}  (${windowName()})`, detail);
}

/** How long a selection has to hold before it is recorded: a drag is one entry, not forty. */
const SELECTION_SETTLE_MS = 400;

/**
 * Record what this window has selected each time it settles, from `describe`.
 *
 * Most of what goes wrong here goes wrong in what is on screen rather than in git, and the
 * steps that lead there are clicks: a commit picked, a file, a branch in the panel. None of
 * those is a command, so without this a log jumps from one command to the next with no
 * way to know what the user was looking at in between.
 */
export function traceSelection(describe: () => string[]): void
{
  describeSelection = describe;
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(
    () => describe().join('\n'),
    () =>
    {
      if (timer)
      {
        clearTimeout(timer);
      }
      timer = setTimeout(() =>
      {
        timer = null;
        send(DIAGNOSTIC_NOTE, `selection  (${windowName()})`, describe());
      }, SELECTION_SETTLE_MS);
    }
  );
}

/**
 * Everything this window throws where nobody caught it.
 *
 * Both handlers, because they catch different halves: `error` is a synchronous throw
 * during render or in a listener, `unhandledrejection` is an awaited call nobody caught,
 * which in an app this async is the more common of the two by far.
 */
/**
 * Called with a one-line message when something failed with nobody to catch it.
 *
 * A hook rather than a direct `useUiStore()` call: this module is loaded by every window,
 * including the dialog windows and the console, and only the ones with a toast stack can
 * show anything. The caller that has one passes it in.
 */
let report: ((message: string) => void) | null = null;

/** Route unhandled failures somewhere the user can see them, not only into the log. */
export function reportUnhandledTo(sink: (message: string) => void): void
{
  report = sink;
}

/** Told where the run's error report went, the first time one is written. */
let reportSaved: ((path: string) => void) | null = null;

/** Say where the report was saved, once per run: see `saveReport`. */
export function reportSavedTo(sink: (path: string) => void): void
{
  reportSaved = sink;
}

/** Whether this window has already said where the report is. */
let savedAnnounced = false;

/**
 * Put the timeline on disk, because the toast about to appear is all the user gets
 * otherwise: it is gone in seconds, and the timeline behind it dies with the window.
 *
 * Fire-and-forget like everything else here, and announced once: a failure that repeats
 * rewrites the same file, and a toast per write would bury the errors it is about.
 */
function saveReport(): void
{
  try
  {
    void api['diagnostics:autoSave']()
      .then((path) =>
      {
        if (path && !savedAnnounced)
        {
          savedAnnounced = true;
          reportSaved?.(path);
        }
      })
      .catch(() =>
      {
        /* A window that cannot save its report still showed the error, which is the point. */
      });
  }
  catch
  {
    /* Same, for a throw on the way in rather than on the way back. */
  }
}

export function installDiagnostics(): void
{
  observeCommands(noteCommandRun);

  window.addEventListener('error', (event: ErrorEvent) =>
  {
    let stack: string | undefined;
    if (event.error instanceof Error)
    {
      stack = event.error.stack;
    }
    send(DIAGNOSTIC_ERROR, `${windowName()}: ${event.message}`, linesOf(stack));
    report?.(event.message);
    saveReport();
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) =>
  {
    const reason: unknown = event.reason;
    let message: string;
    let stack: string | undefined;
    if (reason instanceof Error)
    {
      message = reason.message;
      stack = reason.stack;
    }
    else
    {
      message = String(reason);
    }
    send(DIAGNOSTIC_ERROR, `${windowName()} (unhandled rejection): ${message}`, linesOf(stack));
    report?.(message);
    saveReport();
  });
}
