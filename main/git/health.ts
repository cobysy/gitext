/**
 * Startup health checks: surfaces as a dismissible banner on first run.
 * Split from env.ts: environment sanity is independent from git resolution.
 */

import { homedir, platform } from 'node:os';
import type { GitVersion, HealthCheckItem } from '@shared/types.js';
import { getCachedGitEnvironment, resolveGit } from './env.js';
import { tryGit } from './runner.js';

/** Oldest git we rely on. `--porcelain=v2` needs 2.11; we ask for a bit more. */
const MINIMUM_GIT = { major: 2, minor: 20 };

// Health check status constants
const STATUS_OK = 'ok';
const STATUS_WARN = 'warn';
const STATUS_ERROR = 'error';
const FIX_COMMAND = 'settings.open';

// Git config constants
const CMD_CONFIG = 'config';
const CONFIG_USER_NAME = 'user.name';
const CONFIG_USER_EMAIL = 'user.email';
const CONFIG_MERGE_TOOL = 'merge.tool';
const CONFIG_FLAG = '--get';

// Health check item ids
const CHECK_GIT = 'git';
const CHECK_GIT_VERSION = 'gitVersion';
const CHECK_USER_NAME = 'userName';
const CHECK_USER_EMAIL = 'userEmail';
const CHECK_MERGETOOL = 'mergetool';
const CHECK_HOME = 'home';

const PLATFORM_WIN32 = 'win32';
const ENV_HOME = 'HOME';
const ENV_USERPROFILE = 'USERPROFILE';

function versionAtLeast(v: GitVersion, major: number, minor: number): boolean
{
  return v.major > major || (v.major === major && v.minor >= minor);
}

/**
 * Run the startup health checks.
 *
 * `repoPath` scopes the config lookups so a repo-local `user.email` counts; pass
 * null to check global config only.
 */
export async function healthCheck(repoPath: string | null): Promise<HealthCheckItem[]>
{
  const items: HealthCheckItem[] = [];
  const env = getCachedGitEnvironment() ?? (await resolveGit());
  const cwd = repoPath ?? homedir();

  if (env.error || !env.version)
  {
    items.push({
      id: CHECK_GIT,
      label: 'Git',
      status: STATUS_ERROR,
      detail: env.error ?? `Could not run ${env.path}`,
      fixCommand: FIX_COMMAND
    });
    // Every other check shells out to git, so there is nothing more to test.
    return items;
  }

  items.push({
    id: CHECK_GIT,
    label: 'Git',
    status: STATUS_OK,
    detail: `${env.version.raw} at ${env.path}`
  });

  if (!versionAtLeast(env.version, MINIMUM_GIT.major, MINIMUM_GIT.minor))
  {
    items.push({
      id: CHECK_GIT_VERSION,
      label: 'Git version',
      status: STATUS_WARN,
      detail: `Version ${env.version.major}.${env.version.minor} is older than the supported ${MINIMUM_GIT.major}.${MINIMUM_GIT.minor}; some features may misbehave.`
    });
  }

  const [name, email, mergetool] = await Promise.all([
    tryGit(cwd, [CMD_CONFIG, CONFIG_FLAG, CONFIG_USER_NAME]),
    tryGit(cwd, [CMD_CONFIG, CONFIG_FLAG, CONFIG_USER_EMAIL]),
    tryGit(cwd, [CMD_CONFIG, CONFIG_FLAG, CONFIG_MERGE_TOOL])
  ]);

  const nameSet = name?.trim();
  let nameItem: HealthCheckItem;
  if (nameSet)
  {
    nameItem = { id: CHECK_USER_NAME, label: 'user.name', status: STATUS_OK, detail: nameSet };
  }
  else
  {
    nameItem = {
      id: CHECK_USER_NAME,
      label: 'user.name',
      status: STATUS_ERROR,
      detail: 'Not set, commits will be rejected or misattributed.',
      fixCommand: FIX_COMMAND
    };
  }
  items.push(nameItem);

  const emailSet = email?.trim();
  let emailItem: HealthCheckItem;
  if (emailSet)
  {
    emailItem = { id: CHECK_USER_EMAIL, label: 'user.email', status: STATUS_OK, detail: emailSet };
  }
  else
  {
    emailItem = {
      id: CHECK_USER_EMAIL,
      label: 'user.email',
      status: STATUS_ERROR,
      detail: 'Not set, commits will be rejected or misattributed.',
      fixCommand: FIX_COMMAND
    };
  }
  items.push(emailItem);

  const mergetoolSet = mergetool?.trim();
  let mergetoolItem: HealthCheckItem;
  if (mergetoolSet)
  {
    mergetoolItem = { id: CHECK_MERGETOOL, label: 'merge.tool', status: STATUS_OK, detail: mergetoolSet };
  }
  else
  {
    // Not a problem: this app has a three-way merge editor of its own, and using it is
    // the ordinary outcome. Reported as `ok` so the health banner does not open on every
    // machine accusing the user of a fault whose content is "a good feature will be used".
    mergetoolItem = {
      id: CHECK_MERGETOOL,
      label: 'merge.tool',
      status: STATUS_OK,
      detail: 'Not set: conflicts open in the built-in 3-way merge view.'
    };
  }
  items.push(mergetoolItem);

  // Wrong HOME on Windows: git reads a different .gitconfig than the user has been editing.
  if (platform() === PLATFORM_WIN32)
  {
    const home = process.env[ENV_HOME];
    const profile = process.env[ENV_USERPROFILE];
    const mismatch = home && profile && home !== profile;
    let homeStatus: HealthCheckItem['status'];
    let homeDetail: string;
    if (mismatch)
    {
      homeStatus = STATUS_WARN;
      homeDetail = `HOME (${home}) differs from USERPROFILE (${profile}); git may read a different .gitconfig than you expect.`;
    }
    else
    {
      homeStatus = STATUS_OK;
      homeDetail = home ?? profile ?? homedir();
    }
    items.push({
      id: CHECK_HOME,
      label: 'HOME',
      status: homeStatus,
      detail: homeDetail
    });
  }

  return items;
}
