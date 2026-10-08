/**
 * The watcher over a real git directory with a real socket in it, where the fsmonitor
 * daemon keeps one: in the shared directory and in every linked worktree's.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import chokidar from 'chokidar';
import type { Stats } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { cachedGitDirProbe, ignoredUnder, isChurnIn } from '@main/watchIgnore.js';

const SOCKET = 'fsmonitor--daemon.ipc';

/**
 * A socket's path is capped at 104 bytes on macOS, and the per-user temporary directory
 * spends half of that before the repository starts.
 */
const SHORT_TMP = '/tmp';

let root: string;
let gitDir: string;
let worktreeGitDir: string;
const servers: Server[] = [];

function listen(path: string): Promise<void>
{
  const server = createServer();
  servers.push(server);
  return new Promise((resolve, reject) =>
  {
    server.once('error', reject);
    server.listen(path, resolve);
  });
}

/** Every error the watcher reports over a full scan of `gitDir`. */
async function scanErrors(ignored: (path: string, stats?: Stats) => boolean): Promise<unknown[]>
{
  const errors: unknown[] = [];
  const watcher = chokidar.watch([gitDir], { ignored, ignoreInitial: true, depth: 3 });
  watcher.on('error', (error) => errors.push(error));
  await new Promise<void>((resolve) => watcher.on('ready', resolve));
  await watcher.close();
  return errors;
}

beforeEach(async () =>
{
  root = await realpath(await mkdtemp(join(SHORT_TMP, 'gitext-watch-')));
  gitDir = join(root, '.git');
  worktreeGitDir = join(gitDir, 'worktrees', 'wt');
  await mkdir(join(gitDir, 'refs', 'heads'), { recursive: true });
  await mkdir(worktreeGitDir, { recursive: true });
  await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/wt\n');
  await listen(join(gitDir, SOCKET));
  // A name the churn rules know nothing about: only what it is can keep it out.
  await listen(join(gitDir, 'refs', 'unknown.sock'));
  await listen(join(worktreeGitDir, SOCKET));
});

afterEach(async () =>
{
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(root, { recursive: true, force: true });
});

describe('watching a git directory with sockets in it', () =>
{
  it('scans the whole directory without an error', async () =>
  {
    expect(await scanErrors(ignoredUnder([gitDir], cachedGitDirProbe()))).toEqual([]);
  });

  /** The twin that makes the first mean something: the same scan by path alone fails. */
  it('fails on the socket when only the path decides', async () =>
  {
    const byPath = (path: string): boolean => isChurnIn([gitDir], path, cachedGitDirProbe());
    const errors = await scanErrors(byPath);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('unknown.sock');
  });
});
