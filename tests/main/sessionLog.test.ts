/**
 * The session log: which old logs make room for a new one, and that an entry reaches the
 * file as it is recorded rather than when someone asks for it.
 */

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendToSessionLog,
  openSessionLog,
  SESSION_LOGS_KEPT,
  staleSessionLogs
} from '@main/diagnostics/sessionLog.js';

function logName(stamp: string): string
{
  return `gitext-session-${stamp}.log`;
}

describe('stale session logs', () =>
{
  it('names the oldest beyond what is kept, and nothing else in the folder', () =>
  {
    const names = [
      logName('2026-10-03T09-00-00-000Z'),
      'gitext-crash-2026-10-01T09-00-00-000Z.txt',
      logName('2026-10-01T09-00-00-000Z'),
      logName('2026-10-02T09-00-00-000Z')
    ];
    expect(staleSessionLogs(names, 1)).toEqual([
      logName('2026-10-01T09-00-00-000Z'),
      logName('2026-10-02T09-00-00-000Z')
    ]);
  });

  it('names nothing while there is room', () =>
  {
    expect(staleSessionLogs([logName('2026-10-01T09-00-00-000Z')], 5)).toEqual([]);
  });
});

describe('writing the session log', () =>
{
  let directory = '';

  afterEach(() =>
  {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes the header, then each entry as it arrives', async () =>
  {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'gitext-logs-')));
    const path = openSessionLog(directory, () => ['gitext diagnostics']);
    expect(path).not.toBeNull();

    appendToSessionLog(['12:00:00.000  ERR  window main: boom', '                   at frame']);

    await vi.waitFor(() =>
    {
      expect(readFileSync(path ?? '', 'utf8')).toBe(
        'gitext diagnostics\n\n12:00:00.000  ERR  window main: boom\n                   at frame\n'
      );
    });
  });

  it('prunes the oldest logs so the folder holds no more than it keeps', async () =>
  {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'gitext-logs-')));
    for (let day = 1; day <= SESSION_LOGS_KEPT + 3; day++)
    {
      writeFileSync(join(directory, logName(`2026-01-${String(day).padStart(2, '0')}T00-00-00-000Z`)), '');
    }
    writeFileSync(join(directory, 'gitext-crash-2026-01-01T00-00-00-000Z.txt'), '');

    const path = openSessionLog(directory, () => []);

    // The stream opens its file a tick later; the new log is one of those kept.
    await vi.waitFor(() =>
    {
      expect(readdirSync(directory).map((name) => join(directory, name))).toContain(path);
    });
    const left = readdirSync(directory);
    expect(left.filter((name) => name.startsWith('gitext-session-'))).toHaveLength(SESSION_LOGS_KEPT);
    expect(left).not.toContain(logName('2026-01-01T00-00-00-000Z'));
    expect(left).toContain('gitext-crash-2026-01-01T00-00-00-000Z.txt');
  });
});
