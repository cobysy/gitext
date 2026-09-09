/**
 * What a command-log record keeps of a command's output.
 *
 * The record is kept, the ring holds hundreds, and broadcast to every open window when
 * the process exits, so it carries a capped copy while the caller still gets everything.
 * Against real git, because the split between the two only exists inside `execute`.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_RECORD_OUTPUT, type GitCommandRecord } from '@shared/types.js';
import {
  clearCommandLog,
  getCommandLog,
  runGit,
  runnerEvents,
  streamGitRaw
} from '@main/git/runner.js';

let root = '';
let repo = '';

/** Comfortably past the cap, and compressible enough that git stores it cheaply. */
const BIG_FILE_LINES = 40_000;

beforeAll(async () =>
{
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-runner-')));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-q', 'repo']);
  const big = Array.from({ length: BIG_FILE_LINES }, (_, i) => `line ${i}`).join('\n');
  await writeFile(join(repo, 'big.txt'), big);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

/** The most recent record for a command whose argv starts with `verb`. */
function lastRecordFor(verb: string)
{
  const records = getCommandLog().filter((record) => record.argv[0] === verb);
  return records[records.length - 1];
}

describe('what a record keeps', () =>
{
  it('hands the caller every byte while keeping only the cap', async () =>
  {
    clearCommandLog();
    const out = await runGit(repo, ['ls-files', '--others', '--exclude-standard']);
    // A short read is kept whole and reports no truncation.
    expect(out).toContain('big.txt');
    const short = lastRecordFor('ls-files')!;
    expect(short.stdout).toBe(out);
    expect(short.stdoutBytes).toBeUndefined();

    clearCommandLog();
    const whole = await runGit(repo, ['diff', '--no-index', '--', '/dev/null', 'big.txt'], {
      allowFailure: true
    });

    // The caller's copy is complete: this is what a parser reads.
    expect(whole.length).toBeGreaterThan(MAX_RECORD_OUTPUT);
    expect(whole).toContain(`line ${BIG_FILE_LINES - 1}`);

    // The record's is not, and says so.
    const record = lastRecordFor('diff')!;
    expect(record.stdout).toHaveLength(MAX_RECORD_OUTPUT);
    expect(record.stdout).toBe(whole.slice(0, MAX_RECORD_OUTPUT));
    expect(record.stdoutBytes).toBe(whole.length);
  });

  it('keeps only the cap for a streamed read, and no second copy of it', async () =>
  {
    clearCommandLog();
    let streamed = 0;
    const { done } = streamGitRaw(
      repo,
      ['diff', '--no-index', '--', '/dev/null', 'big.txt'],
      (chunk) =>
      {
        streamed += chunk.length;
      },
      { kind: 'read' }
    );
    const record = await done.catch(() => lastRecordFor('diff')!);

    // Every chunk reached the caller; the record kept the cap and counted the rest.
    expect(streamed).toBeGreaterThan(MAX_RECORD_OUTPUT);
    expect(record.stdout).toHaveLength(MAX_RECORD_OUTPUT);
    expect(record.stdoutBytes).toBe(streamed);
  });
});

describe('what a record says while it is still running', () =>
{
  it('publishes output as it arrives, not only when the command exits', async () =>
  {
    const published: GitCommandRecord[] = [];
    const collect = (record: GitCommandRecord): void =>
    {
      if (record.argv[0] === 'diff')
      {
        published.push(record);
      }
    };
    runnerEvents.on('record', collect);
    try
    {
      await runGit(repo, ['diff', '--no-index', '--', '/dev/null', 'big.txt'], {
        allowFailure: true
      });
    }
    finally
    {
      runnerEvents.off('record', collect);
    }

    // The first is the command starting, with nothing said yet.
    expect(published[0]?.running).toBe(true);
    expect(published[0]?.stdout).toBe('');

    // At least one more arrived while it was still running, carrying what git had
    // printed so far: without it the panel shows nothing until the whole thing lands.
    const live = published.filter((record) => record.running && record.stdout.length > 0);
    expect(live.length).toBeGreaterThan(0);

    const last = published[published.length - 1]!;
    expect(last.running).toBe(false);
    expect(last.stdout.length).toBeGreaterThanOrEqual(live[0]!.stdout.length);
  });
});
