/**
 * `createOutputStream` against real git.
 *
 * Every claim this module makes is about a *running* subprocess, so nothing here can be
 * mocked into being true. Four of them, each of which would fail silently:
 *
 * - **Both streams arrive.** A command can succeed while saying everything on stderr, and
 *   `runGit` returns stdout: so a stdout-only stream would look like it worked and show an
 *   empty pane.
 * - **A non-zero exit is a batch, not a rejection.** A cancelled run dies on a signal with
 *   no exit code, and `git fsck` on a damaged repository exits non-zero having printed the
 *   report somebody opened the window to read. Without `allowFailure` the closing batch
 *   would carry an error over output that is on screen and perfectly legible.
 * - **A cancel still closes the stream.** The final batch is what stops the spinner. This is
 *   where this module deliberately differs from `revisionStream`, which drops its entry on
 *   cancel, and getting it wrong leaves a dialog running forever with no process behind it.
 * - **Facets are announced once, even when the command failed.**
 */

import { mkdir, mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOutputStream } from '@main/ipc/outputStream.js';
import { runGit } from '@main/git/runner.js';
import type { RepoFacet } from '@shared/invalidation.js';
import type { GitStreamBatch } from '@shared/types.js';

let root = '';
let repo = '';

const ID = [
  '-c',
  'user.name=Tour',
  '-c',
  'user.email=tour@example.com',
  '-c',
  'commit.gpgsign=false'
];

interface Harness {
  batches: GitStreamBatch[];
  announced: { path: string; facets: readonly RepoFacet[] }[];
  stream: ReturnType<typeof createOutputStream>;
  /** Resolves with the closing batch for `requestId`. */
  closed(requestId: number): Promise<GitStreamBatch>;
}

function harness(): Harness
{
  const batches: GitStreamBatch[] = [];
  const announced: { path: string; facets: readonly RepoFacet[] }[] = [];
  const waiting = new Map<number, (batch: GitStreamBatch) => void>();

  const stream = createOutputStream(
    (_channel, payload) =>
    {
      batches.push(payload);
      if (payload.done)
      {
        waiting.get(payload.requestId)?.(payload);
      }
    },
    (path, facets) =>
    {
      announced.push({ path, facets });
    }
  );

  return {
    batches,
    announced,
    stream,
    closed: (requestId) =>
      new Promise<GitStreamBatch>((resolve) =>
      {
        const already = batches.find((b) => b.requestId === requestId && b.done);
        if (already)
        {
          resolve(already);
        }
        else
        {
          waiting.set(requestId, resolve);
        }
      })
  };
}

/** Every line of a run, in arrival order. */
function linesOf(batches: GitStreamBatch[], requestId: number): string[]
{
  return batches.filter((b) => b.requestId === requestId).flatMap((b) => b.lines);
}

beforeAll(async () =>
{
  // git canonicalizes paths and /var is a symlink to /private/var on macOS.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-stream-test-')));
  repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'a.txt'), 'one\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, [...ID, 'commit', '-m', 'the first commit']);
});

afterAll(async () =>
{
  await rm(root, { recursive: true, force: true });
});

describe('createOutputStream', () =>
{
  it('streams stderr on a successful command, which is the whole reason it exists', async () =>
  {
    const h = harness();
    // `checkout -b` succeeds and says so: on stderr, with nothing at all on stdout. It is
    // exactly what `git:run` cannot see: through that channel this command resolves with an
    // empty string, which the assertion at the end of this test proves rather than assumes.
    h.stream.start(1, repo, ['checkout', '-b', 'a-new-branch'], ['head', 'refs']);
    const closing = await h.closed(1);

    expect(closing.done).toBe(true);
    expect(closing.exitCode).toBe(0);
    expect(linesOf(h.batches, 1).join('\n')).toContain('a-new-branch');
    // Proof the emptiness is real and not a quirk of the fixture.
    expect(await runGit(repo, ['checkout', '-b', 'another-branch'])).toBe('');
  });

  it('reports a non-zero exit as a code on the closing batch, not as an error', async () =>
  {
    const h = harness();
    h.stream.start(2, repo, ['rev-parse', 'no-such-ref-anywhere'], []);
    const closing = await h.closed(2);

    expect(closing.done).toBe(true);
    expect(closing.exitCode).not.toBe(0);
    // The distinction the whole `allowFailure` decision turns on: git said something, the
    // pane can show it, and nothing here calls that a failure of the stream.
    expect(closing.error).toBeUndefined();
    expect(linesOf(h.batches, 2).join('\n')).toContain('no-such-ref-anywhere');
  });

  it('announces the facets it was given, once, when the process exits', async () =>
  {
    const h = harness();
    h.stream.start(3, repo, ['--version'], ['commits']);
    await h.closed(3);

    expect(h.announced).toEqual([{ path: repo, facets: ['commits'] }]);
  });

  it('still closes the stream when a run is cancelled', async () =>
  {
    const h = harness();
    // A command that waits for stdin it will never get: killed rather than finished, which
    // is the state a cancelled `gc` is in.
    h.stream.start(4, repo, ['hash-object', '--stdin'], []);
    h.stream.cancel(4);
    const closing = await h.closed(4);

    expect(closing.done).toBe(true);
    // No code, because it died on a signal, which is how a dialog tells "cancelled" from
    // "finished with an error".
    expect(closing.exitCode).toBeNull();
  });

  it('drops a superseded run and keeps the replacement', async () =>
  {
    const h = harness();
    h.stream.start(5, repo, ['hash-object', '--stdin'], []);
    // Same id: the second start must replace the first rather than race it.
    h.stream.start(5, repo, ['--version'], []);
    const closing = await h.closed(5);

    expect(closing.exitCode).toBe(0);
    expect(linesOf(h.batches, 5).join('\n')).toContain('git version');
  });
});
