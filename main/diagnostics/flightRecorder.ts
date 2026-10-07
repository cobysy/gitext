/**
 * What git told the app just before something went wrong, in the form the log keeps it.
 *
 * Everything the app knows about a repository arrived as git output, so the output it
 * was working from when it failed *is* the repository, as far as reproducing the fault
 * goes. Kept in memory already (the command log's ring), and only written out when an
 * error makes it worth the space: a session's worth would be megabytes of `git log`.
 *
 * Pure: records in, entries out. The newest run of each distinct command, since the app
 * polls and twenty identical `status` reads say what one does; and only those newer
 * than the last dump, since an earlier error already wrote the rest.
 */

import type { GitCommandRecord } from '@shared/types.js';
import { blankOutput, blankStdin } from './blankContent.js';

/** How far back through the command log a dump looks. */
const RECENT_RECORDS = 300;

/** Lines of one stream a dump keeps: enough of a `git log` to cover what was on screen. */
const MAX_LINES_PER_STREAM = 500;

/** Indent for a stream's lines under its label, so the three read as blocks. */
const STREAM_INDENT = '  ';

export interface RecordedOutput {
  /** Which command, for the entry's line. */
  text: string;
  detail: string[];
  /** The record's id, so the caller knows where the next dump starts. */
  id: number;
}

/** Below this, a character is a control byte; tab and newline are the two a line keeps. */
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;
const KEPT_CONTROLS = new Set(['\t', '\n']);

/** One character as a text file can hold it: a NUL as `\0` and a line break, any other control byte as `\xNN`. */
function visibleChar(char: string): string
{
  if (char === '\x00')
  {
    return '\\0\n';
  }
  const code = char.charCodeAt(0);
  if (KEPT_CONTROLS.has(char) || (code >= FIRST_PRINTABLE && code !== DELETE))
  {
    return char;
  }
  return `\\x${code.toString(16).padStart(2, '0')}`;
}

/**
 * `text` as lines a text file can hold. A NUL is written `\0` and ends its line, since
 * `-z` output is otherwise one line of everything; any other control byte is `\xNN`.
 * A log carrying the raw bytes would read as binary to every tool that opens it.
 */
export function visibleLines(text: string): string[]
{
  let visible = '';
  for (const char of text)
  {
    visible += visibleChar(char);
  }
  const lines = visible.split('\n');
  if (lines.at(-1) === '')
  {
    lines.pop();
  }
  return lines;
}

/** One stream as a labelled, capped block, or nothing when it said nothing. */
function block(label: string, text: string, fullLength?: number): string[]
{
  if (!text)
  {
    return [];
  }
  const lines = visibleLines(text);
  const out = [`${label}:`, ...lines.slice(0, MAX_LINES_PER_STREAM).map((line) => `${STREAM_INDENT}${line}`)];
  if (lines.length > MAX_LINES_PER_STREAM)
  {
    out.push(`${STREAM_INDENT}... ${lines.length - MAX_LINES_PER_STREAM} more lines`);
  }
  if (fullLength !== undefined)
  {
    out.push(`${STREAM_INDENT}... cut short when recorded: ${fullLength} chars in all`);
  }
  return out;
}

/** What was piped to `record` on stdin, file contents taken out, or nothing. */
export function stdinLines(record: GitCommandRecord): string[]
{
  if (record.stdin === undefined)
  {
    return [];
  }
  return block('stdin', blankStdin(record.argv, record.stdin));
}

function outputOf(record: GitCommandRecord): RecordedOutput
{
  const detail = [`in ${record.cwd} · exit ${record.exitCode ?? 'none'}`, ...stdinLines(record)];
  detail.push(...block('stdout', blankOutput(record.argv, record.stdout), record.stdoutBytes));
  detail.push(...block('stderr', record.stderr, record.stderrBytes));
  return { text: record.argv.join(' '), detail, id: record.id };
}

/**
 * The newest finished run of each distinct command among the recent `records`, newer
 * than `afterId`, oldest first, with file contents taken out.
 */
export function recentOutputs(records: readonly GitCommandRecord[], afterId: number): RecordedOutput[]
{
  const newest = new Map<string, GitCommandRecord>();
  for (const record of records.slice(-RECENT_RECORDS))
  {
    if (record.running || record.id <= afterId)
    {
      continue;
    }
    newest.set(`${record.cwd}\x00${record.argv.join('\x00')}`, record);
  }
  return [...newest.values()].sort((a, b) => a.id - b.id).map(outputOf);
}
