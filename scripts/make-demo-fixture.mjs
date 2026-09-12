#!/usr/bin/env node
/**
 * Build `harbour`: the repository the README screenshots are taken on. A history with
 * lanes, branches, tags, a stash and a dirty tree, where `make-commit-fixture.mjs` has
 * two commits and covers the commit screen instead.
 *
 * Dates are offsets from *now*, so the DATE column still reads "last month" on a rebuild.
 *
 * Usage:
 *   npm run fixture:demo -- [--path <dir>] [--force]
 *
 *   --path <dir>  where to build it (default: ../harbour beside this repo)
 *   --force       delete an existing directory at that path first
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) =>
{
  const at = argv.indexOf(`--${name}`);
  if (at !== -1 && argv[at + 1])
  {
    return argv[at + 1];
  }
  else
  {
    return fallback;
  }
};

/** Load-bearing: the switcher, the status bar and the worktree row read it. */
const target = resolve(value('path', join(here, '..', '..', 'harbour')));

// ── git ──────────────────────────────────────────────────────────────────────

/** Identity and settings pinned per call, so the machine's own config cannot change the result. */
const IDENTITY = [
  '-c',
  'user.name=Ada Wong',
  '-c',
  'user.email=ada@example.com',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false'
];

const DAY = 24 * 60 * 60;
const start = Math.floor(Date.now() / 1000);

/** A timestamp this many days before the build, as git wants it. */
const daysAgo = (days) => `${start - Math.round(days * DAY)} +0000`;

let when = daysAgo(0);

function git(args, options = {})
{
  const result = spawnSync('git', [...IDENTITY, ...args], {
    cwd: options.cwd ?? target,
    encoding: 'utf8',
    input: options.input,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: options.when ?? when,
      GIT_COMMITTER_DATE: options.when ?? when
    }
  });
  if (result.status !== 0 && !options.allowFailure)
  {
    console.error(`git ${args.join(' ')}\n${result.stderr}`);
    process.exit(1);
  }
  return (result.stdout ?? '').trim();
}

const write = (path, contents) =>
{
  const full = join(target, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

/** Stage everything and commit it, dated. */
function commit(message, days)
{
  when = daysAgo(days);
  git(['add', '-A']);
  git(['commit', '-q', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

/** A branch off the current HEAD, its commits, and back to where we were. */
function branchFrom(base, name, work)
{
  git(['checkout', '-q', '-B', name, base]);
  work();
  return git(['rev-parse', 'HEAD']);
}

function mergeInto(branch, message, days)
{
  git(['checkout', '-q', 'main']);
  when = daysAgo(days);
  git(['merge', '-q', '--no-ff', '--no-edit', '-m', message, branch]);
  return git(['rev-parse', 'HEAD']);
}

// ── The files the history is made of ─────────────────────────────────────────

const SERVER_BEFORE = `import { createServer as node } from 'node:http';

export function createServer(port: number)
{
  return node((req, res) => res.end('ok')).listen(port);
}
`;

/** Ten added and two taken away, as the screenshot's file list says. */
const SERVER_AFTER = `import { createServer as node } from 'node:http';
import { match, type Route } from './router.js';
import { count } from './metrics.js';

export function createServer(routes: Route[], port: number)
{
  return node((req, res) =>
  {
    count(req.url ?? '/');
    const route = match(routes, req.url ?? '/');
    res.statusCode = route ? 200 : 404;
    res.end(route ? route.handler({}) : 'not found');
  }).listen(port);
}
`;

// ── Build ────────────────────────────────────────────────────────────────────

if (existsSync(target))
{
  if (!flag('force'))
  {
    console.error(`${target} already exists. Pass --force to replace it.`);
    process.exit(1);
  }
  rmSync(target, { recursive: true, force: true });
}

mkdirSync(target, { recursive: true });
git(['init', '-q', '-b', 'main']);

console.log(`Building the screenshot repository in ${target}`);

write('README.md', '# harbour\n\nA small HTTP server, grown one route at a time.\n');
write('src/server.ts', SERVER_BEFORE);
commit('feat: a server that answers on a port', 92);

write('docs/running.md', '# Running it\n\n    npm start\n');
const beforeMetrics = commit('docs: how to run it', 90);

branchFrom(beforeMetrics, 'feature/metrics', () =>
{
  write('src/metrics.ts', 'const counts = new Map<string, number>();\n');
  commit('feat: count requests by name', 82);

  write(
    'src/metrics.ts',
    'const counts = new Map<string, number>();\n\n' +
      'export function count(path: string): void\n{\n  counts.set(path, (counts.get(path) ?? 0) + 1);\n}\n\n' +
      'export function read(): Map<string, number>\n{\n  return counts;\n}\n'
  );
  commit('feat: read the counters back out', 80);

  write('test/metrics.test.ts', "import { count, read } from '../src/metrics.js';\n");
  commit('test: the counters add up', 78);
});

mergeInto('feature/metrics', "Merge branch 'feature/metrics'", 76);
git(['branch', '-q', '-d', 'feature/metrics']);

write('src/index.ts', "export * from './server.js';\nexport * from './metrics.js';\n");
const tagged = commit('refactor: one place to import everything from', 72);
git(['tag', 'v0.2.0', tagged]);

branchFrom(tagged, 'feature/static-files', () =>
{
  write('src/static.ts', "import { readFile } from 'node:fs/promises';\n");
  commit('feat: serve what is in public', 68);
});

mergeInto('feature/static-files', "Merge branch 'feature/static-files'", 66);
git(['branch', '-q', '-d', 'feature/static-files']);

write('src/router.ts', 'export interface Route\n{\n  path: string;\n  handler: (params: object) => string;\n}\n');
commit('feat: a route is a path and a handler', 65);

write('docs/routes.md', '# Routes\n\nA route is a path, a method and a handler.\n');
const beforeLint = commit('docs: write down what a route is', 64);

const lint = branchFrom(beforeLint, 'chore/lint', () =>
{
  write('.eslintrc.json', '{\n  "rules": {\n    "no-console": "error"\n  }\n}\n');
  commit('chore: fail the build on a stray console call', 62);
});

git(['checkout', '-q', 'main']);
write('src/server.ts', SERVER_AFTER);
const throughTheRouter = commit('feat: the server answers through the router', 60);

const routing = branchFrom(throughTheRouter, 'feature/routing', () =>
{
  write(
    'src/router.ts',
    'export interface Route\n{\n  path: string;\n  handler: (params: object) => string;\n}\n\n' +
      'export function match(routes: Route[], path: string): Route | undefined\n{\n' +
      '  return routes.find((route) => route.path === path);\n}\n'
  );
  commit('feat: match a path to a handler', 56);
});

const middleware = branchFrom(throughTheRouter, 'feature/middleware', () =>
{
  write('src/middleware.ts', 'export type Middleware = (next: () => string) => string;\n');
  commit('feat: a middleware chain, applied right to left', 52);

  write(
    'src/middleware.ts',
    'export type Middleware = (next: () => string) => string;\n\n' +
      'export function chain(layers: Middleware[], inner: () => string): () => string\n{\n' +
      '  return layers.reduceRight((next, layer) => () => layer(next), inner);\n}\n'
  );
  commit('feat: let the caller supply the innermost handler', 50);

  write('test/middleware.test.ts', "import { chain } from '../src/middleware.js';\n");
  commit('test: the order the chain runs in', 48);
});

const merged = mergeInto('feature/middleware', "Merge branch 'feature/middleware'", 46);

write('src/config.ts', 'export const config = {\n  public: "./public",\n  timeout: 5000\n};\n');
const head = commit('feat: configuration knows where the files are', 34);
git(['tag', 'v0.3.0', head]);
git(['tag', 'v0.1.0', beforeMetrics]);

branchFrom(head, 'fix/header-casing', () =>
{
  write('src/headers.ts', 'export const normalize = (name: string) => name.toLowerCase();\n');
  commit('fix: compare header names case-insensitively', 32);
});

branchFrom(head, 'feature/websockets', () =>
{
  write('src/upgrade.ts', '// where the websocket upgrade will go\n');
  commit('wip: where the websocket upgrade will go', 30);
});

git(['checkout', '-q', 'main']);

// ── The remote, which is never contacted ─────────────────────────────────────

/* No network: the tracking refs go straight in. `origin/main` stops one short, the `↑1`. */
git(['remote', 'add', 'origin', 'git@github.com:ada/harbour.git']);
git(['update-ref', 'refs/remotes/origin/main', merged]);
git(['update-ref', 'refs/remotes/origin/chore/lint', lint]);
git(['update-ref', 'refs/remotes/origin/feature/middleware', middleware]);
git(['update-ref', 'refs/remotes/origin/feature/routing', routing]);
git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);

for (const branch of ['main', 'chore/lint', 'feature/middleware', 'feature/routing'])
{
  git(['config', `branch.${branch}.remote`, 'origin']);
  git(['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
}

// ── A stash, and a working tree with something in it ─────────────────────────

when = daysAgo(0);

write('src/config.ts', 'export const config = {\n  public: "./public",\n  timeout: 30000\n};\n');
git(['stash', 'push', '-q', '-m', 'raising the timeout']);

// `2 modified, 1 new` unstaged, `1 modified` staged, `4 changed`.
write('src/router.ts', `export interface Route\n{\n  path: string;\n  method: string;\n  handler: (params: object) => string;\n}\n`);
git(['add', 'src/router.ts']);

write('src/server.ts', SERVER_AFTER.replace('res.statusCode = route ? 200 : 404;', 'res.statusCode = route ? 200 : 404;\n    res.setHeader("x-served-by", "harbour");'));
write('src/metrics.ts', 'const counts = new Map<string, number>();\n// reset between runs\n');
write('src/health.ts', "export const health = () => ({ ok: true });\n");

console.log(`
Built: six branches in three folders, three tags, one stash, four changes, a remote
that stops one commit behind \`main\`. Shoot the README on it with:

  npm run build
  node .claude/skills/run-app/drive.mjs --repo ${target} --theme dark "shot repository-window"
`);
