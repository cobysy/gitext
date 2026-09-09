/**
 * Turning the timeline into the text a person attaches to a bug report.
 *
 * Pure: takes entries and options, returns a string. No `app`, no `fs`, no ring, so what
 * a report reads like is an ordinary unit test rather than something to eyeball.
 */

import {
  DIAGNOSTIC_COMMAND,
  DIAGNOSTIC_ERROR,
  DIAGNOSTIC_GIT,
  DIAGNOSTIC_NOTE,
  DIAGNOSTIC_SESSION,
  DIAGNOSTIC_TIMING,
  SLOW_MS,
  type DiagnosticEntry
} from '@shared/types/diagnostics.js';
import { redactLine, type RedactOptions } from './redact.js';

/** The four-letter column that lets a reader scan for the kind they want. */
const TAGS: Record<string, string> = {
  [DIAGNOSTIC_SESSION]: 'app',
  [DIAGNOSTIC_COMMAND]: 'cmd',
  [DIAGNOSTIC_GIT]: 'git',
  [DIAGNOSTIC_ERROR]: 'ERR',
  [DIAGNOSTIC_NOTE]: '   ',
  [DIAGNOSTIC_TIMING]: 'ms '
};

/** Indent for a detail line, lining it up under the text rather than the timestamp. */
const DETAIL_INDENT = ' '.repeat(19);

export interface ReportOptions {
  /** Off by default: see `redact.ts` for what turning it on removes. */
  redact: boolean;
  redaction: RedactOptions;
  /** Now, so the header can say how long the session had been running. */
  generatedAt: number;
}

/** `12:04:31.284`, local time: a report is read beside the clock the user was watching. */
function clockOf(at: number): string
{
  const date = new Date(at);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** What a run cost and how it ended, or nothing when neither is known yet. */
function outcomeOf(entry: DiagnosticEntry): string
{
  const parts: string[] = [];
  if (entry.exitCode !== undefined && entry.exitCode !== null)
  {
    parts.push(`exit ${entry.exitCode}`);
  }
  if (entry.durationMs !== undefined)
  {
    parts.push(`${entry.durationMs}ms`);
    // A word to grep, so a reader with two thousand lines can find the handful that
    // stalled without reading all of them.
    if (entry.durationMs >= SLOW_MS)
    {
      parts.push('SLOW');
    }
  }
  if (parts.length === 0)
  {
    return '';
  }
  return `  · ${parts.join(' · ')}`;
}

function scrub(text: string, options: ReportOptions): string
{
  if (!options.redact)
  {
    return text;
  }
  return redactLine(text, options.redaction);
}

/**
 * The same timeline as one JSON object per line.
 *
 * For a reader that wants to count and group rather than scan: "which command ran before
 * every error", "the ten slowest git calls", "how many layouts per refresh" are one
 * `jq` away here and a regexp against a fixed-width column in the text form. Same
 * entries, same order, same redaction; only the shape differs.
 */
export function renderReportLines(
  entries: readonly DiagnosticEntry[],
  options: ReportOptions
): string
{
  const lines = entries.map((entry) =>
  {
    const out: Record<string, unknown> = {
      at: new Date(entry.at).toISOString(),
      kind: entry.kind,
      text: scrub(entry.text, options)
    };
    if (entry.durationMs !== undefined)
    {
      out.durationMs = entry.durationMs;
      out.slow = entry.durationMs >= SLOW_MS;
    }
    if (entry.exitCode !== undefined && entry.exitCode !== null)
    {
      out.exitCode = entry.exitCode;
    }
    if (entry.detail && entry.detail.length > 0)
    {
      out.detail = entry.detail.map((line) => scrub(line, options));
    }
    return JSON.stringify(out);
  });
  return `${lines.join('\n')}\n`;
}

/**
 * The whole report. Entries are written in the order they were recorded, because the
 * order *is* the finding: which command ran before the error is the whole question.
 */
export function renderReport(
  entries: readonly DiagnosticEntry[],
  options: ReportOptions
): string
{
  const lines: string[] = [];

  lines.push('gitext diagnostics');
  lines.push(`generated ${new Date(options.generatedAt).toISOString()}`);
  if (options.redact)
  {
    lines.push('redacted: home path, remote credentials and commit message bodies removed');
  }
  else
  {
    lines.push(
      'NOT redacted: contains paths, branch names, commit messages and git output'
    );
  }
  lines.push(`${entries.length} entries`);
  lines.push('');

  for (const entry of entries)
  {
    const tag = TAGS[entry.kind] ?? '   ';
    lines.push(`${clockOf(entry.at)}  ${tag}  ${scrub(entry.text, options)}${outcomeOf(entry)}`);
    for (const detail of entry.detail ?? [])
    {
      // A blank detail line is a paragraph break in git's own output; keep it as one.
      if (detail.length === 0)
      {
        lines.push('');
        continue;
      }
      lines.push(`${DETAIL_INDENT}${scrub(detail, options)}`);
    }
  }

  // A trailing newline: the file is read with `cat` as often as in an editor.
  lines.push('');
  return lines.join('\n');
}
