/**
 * The two pure halves of diagnostics: what a report reads like, and what scrubbing one
 * takes out.
 *
 * Both matter for the same reason. A report is read by someone who was not there, so its
 * shape is the whole product; and redaction is the promise that a file can be attached to
 * a public issue, which is only worth making if each rule is actually checked.
 */

import { describe, expect, it } from 'vitest';
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
import { renderReport, renderReportLines } from '@main/diagnostics/report.js';
import { redactArgv, redactLine, redactPaths, redactUrls } from '@main/diagnostics/redact.js';

const HOME = '/Users/someone';
const REPO = `${HOME}/Projects/acme`;
const REDACTION = { home: HOME, repoRoot: REPO };

/** A fixed instant, so the rendered clock is a constant rather than "now". */
const AT = Date.UTC(2026, 8, 4, 10, 4, 31, 284);

function entry(over: Partial<DiagnosticEntry> = {}): DiagnosticEntry
{
  return { at: AT, kind: DIAGNOSTIC_GIT, text: 'status', ...over };
}

describe('redaction', () =>
{
  it('makes a path inside the repository repo-relative', () =>
  {
    expect(redactPaths(`${REPO}/src/app.ts`, REDACTION)).toBe('src/app.ts');
  });

  it('leaves the repository root itself as a `~` path: it names the repository', () =>
  {
    expect(redactPaths(REPO, REDACTION)).toBe('~/Projects/acme');
  });

  it('falls back to `~` for a path outside the repository', () =>
  {
    expect(redactPaths(`${HOME}/Downloads/patch.diff`, REDACTION)).toBe('~/Downloads/patch.diff');
  });

  it('leaves a path that says nothing personal alone', () =>
  {
    expect(redactPaths('/usr/local/bin/git', REDACTION)).toBe('/usr/local/bin/git');
  });

  it('strips the credentials out of a remote URL, keeping the host', () =>
  {
    expect(redactUrls('https://alice:ghp_secret@github.com/acme/app.git')).toBe(
      'https://<redacted>@github.com/acme/app.git'
    );
  });

  it('leaves a remote URL with no credentials in it alone', () =>
  {
    const url = 'https://github.com/acme/app.git';
    expect(redactUrls(url)).toBe(url);
  });

  /** The verb and the flag are the report; the prose after them never has been. */
  it('shortens a commit message but keeps the command that carried it', () =>
  {
    const argv = ['commit', '-m', 'fix pricing for BigCo before the Q3 renewal call'];
    expect(redactArgv(argv, REDACTION)).toEqual([
      'commit',
      '-m',
      'fix pricing for BigCo be… (48 chars)'
    ]);
  });

  it('shortens a message given as one token', () =>
  {
    const [, message] = redactArgv(['commit', '--message=a very long message indeed, truly'], REDACTION);
    expect(message).toBe('--message=a very long message inde… (33 chars)');
  });

  it('leaves a short message whole: there is nothing to hide in `wip`', () =>
  {
    expect(redactArgv(['commit', '-m', 'wip'], REDACTION)).toEqual(['commit', '-m', 'wip']);
  });

  it('scrubs paths and URLs inside an argv', () =>
  {
    expect(redactArgv(['remote', 'add', 'origin', 'https://u:p@example.com/x.git'], REDACTION))
      .toEqual(['remote', 'add', 'origin', 'https://<redacted>@example.com/x.git']);
  });

  it('does both to one line of free text', () =>
  {
    expect(redactLine(`fatal: ${REPO}/a.txt and https://u:p@h/x`, REDACTION))
      .toBe('fatal: a.txt and https://<redacted>@h/x');
  });
});

describe('the report', () =>
{
  const entries: DiagnosticEntry[] = [
    entry({ kind: DIAGNOSTIC_SESSION, text: 'gitext 0.0.1', detail: ['darwin 27.0.0'] }),
    entry({ kind: DIAGNOSTIC_NOTE, text: `repository ${REPO}`, detail: ['branch main'] }),
    entry({ kind: DIAGNOSTIC_COMMAND, text: 'branch.checkout  (window main)' }),
    entry({ text: 'checkout release/2.50', durationMs: 602, exitCode: 0 }),
    entry({ kind: DIAGNOSTIC_ERROR, text: 'main process: boom', detail: ['at doThing (x.ts:1)'] })
  ];

  function report(redact: boolean): string
  {
    return renderReport(entries, { redact, redaction: REDACTION, generatedAt: AT });
  }

  it('tags each kind so a reader can scan for one', () =>
  {
    const text = report(false);
    expect(text).toContain('  app  gitext 0.0.1');
    expect(text).toContain('  cmd  branch.checkout  (window main)');
    expect(text).toContain('  git  checkout release/2.50  · exit 0 · 602ms');
    expect(text).toContain('  ERR  main process: boom');
  });

  it('keeps the entries in the order they happened, which is the finding', () =>
  {
    const text = report(false);
    expect(text.indexOf('branch.checkout')).toBeLessThan(text.indexOf('checkout release/2.50'));
    expect(text.indexOf('checkout release/2.50')).toBeLessThan(text.indexOf('main process: boom'));
  });

  it('says which kind of file it is, both ways round', () =>
  {
    expect(report(false)).toContain('NOT redacted: contains paths');
    expect(report(true)).toContain('redacted: home path');
  });

  it('leaves the repository path alone when redaction is off', () =>
  {
    expect(report(false)).toContain(REPO);
  });

  it('takes the repository path out when it is on', () =>
  {
    expect(report(true)).not.toContain(REPO);
    expect(report(true)).not.toContain(HOME);
  });

  it('indents a detail line under its entry rather than beside the clock', () =>
  {
    expect(report(false)).toContain('\n                   darwin 27.0.0');
  });

  it('omits an outcome for an entry that has none', () =>
  {
    const line = report(false).split('\n').find((l) => l.includes('branch.checkout'))!;
    expect(line).not.toContain('·');
  });

  /**
   * A word to grep for. A reader handed two thousand lines needs to find the handful
   * that stalled without reading all of them, and "250ms" is not a thing you can search.
   */
  it('marks an entry over the threshold as slow, and one under it not', () =>
  {
    const slow = entry({ kind: DIAGNOSTIC_TIMING, text: 'graph layout', durationMs: SLOW_MS });
    const quick = entry({ kind: DIAGNOSTIC_TIMING, text: 'graph layout', durationMs: SLOW_MS - 1 });
    const text = renderReport([slow, quick], { redact: false, redaction: REDACTION, generatedAt: AT });
    const [slowLine, quickLine] = text.split('\n').filter((l) => l.includes('graph layout'));
    expect(slowLine).toContain('SLOW');
    expect(quickLine).not.toContain('SLOW');
  });

  it('gives the app\'s own work its own tag, so git is not the only thing timed', () =>
  {
    const text = renderReport(
      [entry({ kind: DIAGNOSTIC_TIMING, text: 'log read', durationMs: 194 })],
      { redact: false, redaction: REDACTION, generatedAt: AT }
    );
    expect(text).toContain('  ms   log read  · 194ms');
  });

  it('renders an empty session without inventing entries', () =>
  {
    const text = renderReport([], { redact: false, redaction: REDACTION, generatedAt: AT });
    expect(text).toContain('0 entries');
  });
});

/**
 * The same timeline, shaped for counting rather than reading: "which command ran before
 * every error", "the ten slowest git calls". One `jq` away here, a regexp against a
 * fixed-width column in the text form.
 */
describe('the report as JSON lines', () =>
{
  const entries: DiagnosticEntry[] = [
    entry({ kind: DIAGNOSTIC_COMMAND, text: 'branch.checkout' }),
    entry({ text: `checkout ${REPO}/x`, durationMs: SLOW_MS + 1, exitCode: 0, detail: ['said something'] }),
    entry({ kind: DIAGNOSTIC_TIMING, text: 'graph layout', durationMs: 10 })
  ];

  function parse(redact: boolean): Record<string, unknown>[]
  {
    const text = renderReportLines(entries, { redact, redaction: REDACTION, generatedAt: AT });
    return text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('writes one parseable object per entry, in order', () =>
  {
    const rows = parse(false);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.kind)).toEqual([DIAGNOSTIC_COMMAND, DIAGNOSTIC_GIT, DIAGNOSTIC_TIMING]);
  });

  it('marks slow as a boolean rather than a word to match', () =>
  {
    const [, git, timing] = parse(false);
    expect(git!.slow).toBe(true);
    expect(timing!.slow).toBe(false);
  });

  it('leaves out what an entry does not have, rather than writing nulls', () =>
  {
    const [command] = parse(false);
    expect(command).not.toHaveProperty('durationMs');
    expect(command).not.toHaveProperty('exitCode');
    expect(command).not.toHaveProperty('detail');
  });

  it('redacts exactly as the text form does', () =>
  {
    expect(JSON.stringify(parse(false))).toContain(REPO);
    expect(JSON.stringify(parse(true))).not.toContain(REPO);
  });

  it('ends with a newline, so the file appends cleanly', () =>
  {
    const text = renderReportLines(entries, { redact: false, redaction: REDACTION, generatedAt: AT });
    expect(text.endsWith('\n')).toBe(true);
  });
});
