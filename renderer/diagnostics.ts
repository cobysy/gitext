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
  DIAGNOSTIC_TIMING,
  type DiagnosticKind
} from '@shared/types/diagnostics.js';
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

/** A command the user ran, by id. Handed to `runCommand`, the one funnel they all pass. */
function noteCommandRun(id: string): void
{
  send(DIAGNOSTIC_COMMAND, `${id}  (${windowName()})`);
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
  });
}
