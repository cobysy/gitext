/**
 * Which git output an error writes into the log, and the form it takes there.
 */

import { describe, expect, it } from 'vitest';
import type { GitCommandRecord } from '@shared/types.js';
import { recentOutputs, visibleLines } from '@main/diagnostics/flightRecorder.js';

function run(id: number, argv: string[], over: Partial<GitCommandRecord> = {}): GitCommandRecord
{
  return {
    id,
    argv,
    fullArgv: argv,
    cwd: '/repo',
    kind: 'read',
    startedAt: 0,
    durationMs: 1,
    exitCode: 0,
    stdout: '',
    stderr: '',
    running: false,
    ...over
  };
}

describe('the output an error writes', () =>
{
  it('keeps the newest run of each command, oldest first', () =>
  {
    const records = [
      run(1, ['status'], { stdout: 'first' }),
      run(2, ['log'], { stdout: 'history' }),
      run(3, ['status'], { stdout: 'second' })
    ];
    const outputs = recentOutputs(records, 0);
    expect(outputs.map((o) => o.text)).toEqual(['log', 'status']);
    expect(outputs[1]?.detail).toContain('  second');
  });

  it('skips what an earlier dump wrote, and what is still running', () =>
  {
    const records = [run(1, ['log']), run(2, ['status']), run(3, ['fetch'], { running: true })];
    expect(recentOutputs(records, 1).map((o) => o.text)).toEqual(['status']);
  });

  it('carries a staged patch with its code taken out', () =>
  {
    const patch = '@@ -1 +1 @@\n-secret old\n+secret new';
    const [output] = recentOutputs([run(1, ['apply', '--cached'], { stdin: patch })], 0);
    expect(output?.detail).toEqual(['in /repo · exit 0', 'stdin:', '  @@ -1 +1 @@', '  -×1', '  +×1']);
  });

  it('says when a stream was cut short as it was recorded', () =>
  {
    const [output] = recentOutputs([run(1, ['log'], { stdout: 'a', stdoutBytes: 90000 })], 0);
    expect(output?.detail.at(-1)).toContain('90000 chars in all');
  });
});

describe('visible lines', () =>
{
  /** Raw NULs would make the log read as binary to every tool that opens it. */
  it('writes a NUL as text and breaks the line there', () =>
  {
    expect(visibleLines('a.ts\x00b.ts\x00')).toEqual(['a.ts\\0', 'b.ts\\0']);
  });

  it('writes any other control byte as an escape', () =>
  {
    expect(visibleLines('bell\x07')).toEqual(['bell\\x07']);
  });
});
