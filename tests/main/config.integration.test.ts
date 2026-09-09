/**
 * Scoped `git config` reads and writes, against real git.
 *
 * The settings window's Git section rests on three claims none of which the compiler can
 * check: that `--global` and `--local` are separately readable and writable, that an unset
 * key is distinguishable from an empty one, and that unsetting a key that was never set is
 * a success rather than the error git's exit code 5 makes it look like. Each one silently
 * ruins the form if it is wrong: the last would put an error under a field for a no-op.
 *
 * `GIT_CONFIG_GLOBAL` points at a file in the temp directory for the whole file. Without
 * it these tests would write `user.name` into the config of whoever ran them.
 */

import { mkdtemp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConfigReadArgs,
  buildConfigWriteArgs,
  readConfigValues,
  writeConfigValue
} from '@main/git/config.js';
import { runGit } from '@main/git/runner.js';

let root = '';
let repo = '';
let globalConfig = '';
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;

beforeAll(async () =>
{
  // git canonicalizes paths and /var is a symlink to /private/var on macOS.
  root = await realpath(await mkdtemp(join(tmpdir(), 'gitext-config-test-')));
  repo = join(root, 'repo');
  globalConfig = join(root, 'gitconfig');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;

  await mkdir(repo, { recursive: true });
  await runGit(repo, ['init', '-b', 'main']);
});

beforeEach(async () =>
{
  await writeFile(globalConfig, '');
  await runGit(repo, ['config', '--local', '--remove-section', 'user']).catch(() =>
  {
    // No section yet, which is the state this is trying to reach.
  });
});

afterAll(async () =>
{
  if (savedGlobal === undefined)
  {
    delete process.env.GIT_CONFIG_GLOBAL;
  }
  else
  {
    process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  }
  await rm(root, { recursive: true, force: true });
});

describe('the argv', () =>
{
  it('passes no scope flag for the effective value', () =>
  {
    // Which is what makes git resolve local over global over system, rather than reading
    // one file. A `--effective` flag does not exist and inventing one would be an error.
    expect(buildConfigReadArgs('effective', 'user.name')).toEqual([
      'config',
      '--get',
      'user.name'
    ]);
  });

  it('names the file for a scoped read or write', () =>
  {
    expect(buildConfigReadArgs('global', 'user.name')).toEqual([
      'config',
      '--global',
      '--get',
      'user.name'
    ]);
    expect(buildConfigWriteArgs('local', 'user.name', 'Ada')).toEqual([
      'config',
      '--local',
      'user.name',
      'Ada'
    ]);
  });

  it('unsets rather than writing an empty value', () =>
  {
    expect(buildConfigWriteArgs('global', 'core.autocrlf', null)).toEqual([
      'config',
      '--global',
      '--unset',
      'core.autocrlf'
    ]);
  });
});

describe('readConfigValues / writeConfigValue', () =>
{
  it('writes and reads back one scope without touching the other', async () =>
  {
    await writeConfigValue(repo, 'global', 'user.name', 'Global Name');
    await writeConfigValue(repo, 'local', 'user.name', 'Local Name');

    expect(await readConfigValues(repo, 'global', ['user.name'])).toEqual({
      'user.name': 'Global Name'
    });
    expect(await readConfigValues(repo, 'local', ['user.name'])).toEqual({
      'user.name': 'Local Name'
    });
    // The local file wins, which is the whole reason both scopes are offered.
    expect(await readConfigValues(repo, 'effective', ['user.name'])).toEqual({
      'user.name': 'Local Name'
    });
  });

  it('leaves an unset key out of the result rather than reporting it empty', async () =>
  {
    await writeConfigValue(repo, 'global', 'user.name', 'Only The Name');

    const values = await readConfigValues(repo, 'global', ['user.name', 'user.email']);
    expect(values).toEqual({ 'user.name': 'Only The Name' });
    // The form shows the inherited value as a placeholder when the key is missing, and
    // cannot tell missing from empty if git reports both the same way.
    expect('user.email' in values).toBe(false);
  });

  it('unsets a key it has set', async () =>
  {
    await writeConfigValue(repo, 'global', 'core.autocrlf', 'input');
    await writeConfigValue(repo, 'global', 'core.autocrlf', null);
    expect(await readConfigValues(repo, 'global', ['core.autocrlf'])).toEqual({});
  });

  it('treats unsetting a key that was never set as done, not as a failure', async () =>
  {
    // `git config --unset` exits 5 for this. The state asked for is the state on disk, so
    // the only thing an error here would do is put a message under a field nobody changed.
    await expect(
      writeConfigValue(repo, 'global', 'merge.tool', null)
    ).resolves.toBeUndefined();
  });

  it('surfaces a set git refuses', async () =>
  {
    // A key with no section is not a key. This is the half that must not be swallowed:
    // a form that reports success and writes nothing is worse than one that says why.
    await expect(writeConfigValue(repo, 'global', 'nosection', 'x')).rejects.toThrow();
  });

  it('answers the global scope with no repository at all', async () =>
  {
    // The case the nullable path exists for: the first-run health check runs before any
    // repository has been opened, and its Fix button has to lead somewhere that works.
    await writeConfigValue(null, 'global', 'user.email', 'nobody@example.com');
    expect(await readConfigValues(null, 'global', ['user.email'])).toEqual({
      'user.email': 'nobody@example.com'
    });
    expect(await readFile(globalConfig, 'utf8')).toContain('nobody@example.com');
  });
});
